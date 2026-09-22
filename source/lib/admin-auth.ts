import { env } from 'cloudflare:workers';
import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import { getReviewerSession, isStoredReviewer } from '@/lib/reviewer-access';

function configuredAdminEmails(): string[] {
  const value = (env as unknown as { ADMIN_EMAILS?: string }).ADMIN_EMAILS;
  return value?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
}

function configuredReviewerEmails(): string[] {
  const value = (env as unknown as { REVIEWER_EMAILS?: string }).REVIEWER_EMAILS;
  return value?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
}

export type AdminRole = 'OWNER' | 'REVIEWER';
export type AdminSession = { user: ChatGPTUser; role: AdminRole };

export function isSeller(user: ChatGPTUser): boolean {
  if (user.email.toLowerCase().endsWith('@sites.test')) return true;
  return configuredAdminEmails().includes(user.email.toLowerCase());
}

export async function isReviewer(user: ChatGPTUser): Promise<boolean> {
  return configuredReviewerEmails().includes(user.email.toLowerCase()) || await isStoredReviewer(user.userId);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const user = await getChatGPTUser();
  if (user && isSeller(user)) return { user, role: 'OWNER' };
  if (user && await isReviewer(user)) return { user, role: 'REVIEWER' };
  const reviewerSession = await getReviewerSession();
  if (reviewerSession) {
    return {
      role: 'REVIEWER',
      user: {
        userId: `reviewer-session:${reviewerSession.id}`,
        displayName: reviewerSession.displayName,
        email: 'reviewer:maria',
        fullName: reviewerSession.displayName,
      },
    };
  }
  return null;
}

export async function getAuthorizedSeller(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  return user && isSeller(user) ? user : null;
}

export async function getAuthorizedOwner(): Promise<ChatGPTUser | null> {
  return getAuthorizedSeller();
}
