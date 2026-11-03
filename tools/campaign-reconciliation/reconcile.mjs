import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { supersedeCampaignAssignments, REGULAR_CAMPAIGN, LEDGER_KEY, BASELINE_KEY } from '../../netlify/functions/_shared/regular-campaign.mjs';

// No production connection in default mode. --apply requires separate Governance authorization.
const args = process.argv.slice(2), apply = args[0] === '--apply';
if (apply) args.shift();
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--operation', '--snapshot', '--backup', '--published-commit'].includes(args[i]) ||
      !args[i + 1] || options[args[i]]) throw Error('Invalid or duplicate option');
  options[args[i]] = args[i + 1];
}
if (!options['--operation']) throw Error('Provide --operation; default is an offline plan using --snapshot');
const operation = JSON.parse(await readFile(options['--operation'], 'utf8'));
if (operation.campaignId !== REGULAR_CAMPAIGN || operation.cycleId !== 'c92e1d2b-5284-4350-a9e2-f886b897cfaa' ||
    operation.batchId !== 'be882a9c-0b87-4270-b23a-5eaf77a9b56b' || operation.person !== 'Maria' ||
    operation.id !== 'governance-20261103-nov2-maria-113-425' ||
    JSON.stringify(operation.productIds) !== JSON.stringify(['real-202609-volume2-113', 'real-202610-volume4-425'])) {
  throw Error('This tool permits only the reviewed November 2 Maria supersession');
}
const hash = text => createHash('sha256').update(text).digest('hex');
let store, snapshot;
if (!apply) {
  if (!options['--snapshot'] || options['--backup'] || options['--published-commit']) throw Error('Offline plan requires only --operation and --snapshot');
  snapshot = JSON.parse(await readFile(options['--snapshot'], 'utf8'));
  const files = new Map([[LEDGER_KEY, snapshot.ledger], [BASELINE_KEY, snapshot.baseline]]);
  store = {
    getWithMetadata: async key => structuredClone(files.get(key)),
    get: async key => structuredClone(files.get(key)?.data),
    setJSON: async (key, data, conditions) => {
      if (key !== LEDGER_KEY || conditions.onlyIfMatch !== files.get(key).etag) throw Error('Unexpected offline write');
      files.set(key, { data: structuredClone(data), etag: 'offline-planned-etag' });
      return { modified: true, etag: 'offline-planned-etag' };
    },
  };
} else {
  const siteID = '9b8acb37-246c-43a0-af78-e68f48e36ea0', token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token || !options['--backup'] || !/^[a-f0-9]{40}$/.test(options['--published-commit'] || '') || options['--snapshot']) {
    throw Error('Apply requires NETLIFY_AUTH_TOKEN, a new --backup path and the authorized --published-commit');
  }
  const response = await fetch(`https://api.netlify.com/api/v1/sites/${siteID}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error(`Site verification failed: ${response.status}`);
  const site = await response.json();
  if (site.custom_domain !== 'thelabossieres.com' || site.build_settings.repo_path !== 'davelaboss/psych' ||
      site.published_deploy.locked !== true || site.published_deploy.commit_ref !== options['--published-commit']) throw Error('Published identity/protection mismatch');
  store = getStore({ name: 'mudanza-regular-chatgpt-marketing', siteID, token, consistency: 'strong' });
  const ledgerRaw = await store.getWithMetadata(LEDGER_KEY, { type: 'text', consistency: 'strong' });
  const baselineRaw = await store.getWithMetadata(BASELINE_KEY, { type: 'text', consistency: 'strong' });
  if (!ledgerRaw || !baselineRaw) throw Error('Missing established ledger/baseline');
  snapshot = { capturedAt: new Date().toISOString(), published: { id: site.published_deploy.id, sha: site.published_deploy.commit_ref, locked: true },
    ledger: { ...ledgerRaw, data: JSON.parse(ledgerRaw.data) }, baseline: { ...baselineRaw, data: JSON.parse(baselineRaw.data) } };
  await writeFile(options['--backup'], JSON.stringify({ ...snapshot, raw: { ledger: ledgerRaw.data, baseline: baselineRaw.data },
    rawSha256: { ledger: hash(ledgerRaw.data), baseline: hash(baselineRaw.data) }, operation }, null, 2), { flag: 'wx' });
}
const result = await supersedeCampaignAssignments({ operation, store });
const baselineAfter = await store.getWithMetadata(BASELINE_KEY, { type: 'json', consistency: 'strong' });
if (baselineAfter.etag !== snapshot.baseline.etag || JSON.stringify(baselineAfter.data) !== JSON.stringify(snapshot.baseline.data)) {
  throw Error('Baseline changed; stop and investigate without restoring older data');
}
console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'OFFLINE_PLAN_ONLY', changed: result.changed,
  revision: result.history.revision, supersessions: result.history.supersessions, campaign: result.campaign,
  resultingHistorySha256: hash(JSON.stringify(result.history)) }, null, 2));
