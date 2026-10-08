import { createHash } from 'node:crypto';

export const LEGACY_REVIEW_STATE_CHANGED =
  'El estado cambió; revisá este pago manualmente.';

const keyFor = (orderId, paymentId) => `${orderId}|${paymentId}`;
const rawSource = payment => payment?.amountSource == null ? 'ABSENT' : payment.amountSource;
const number = value => Number(value || 0);
const normalizedTimestamp = value => value == null ? null : Number(value);

const ENTRIES = [
  {"orderId":"VM-2026-042A512D","customer":"Nadia Acin","paymentId":"d8b81b2f-0f43-4d6c-b97e-2fd6b23a6f06","amountPYG":238000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-042A512D/c129eb25-1cc2-4848-8792-11e320eac7fd","receiptSha256":"5ed36ecc9710bc00bd44855ccd3442188a4aecb0dd8c5e2e9d09eb7c31b1209c","confirmedAt":1790956737708,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":238000,"dueNowPYG":238000,"paidAmountPYG":238000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":"OWNER_CONFIRMED_CASH"},
  {"orderId":"VM-2026-07FFBAE0","customer":"Fabiola Benitez","paymentId":"legacy-initial","amountPYG":450000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-07FFBAE0/b9ac7d72-f414-4e04-a9d2-77f10dae2a29","receiptSha256":"85c762973edf1f611e194ab5708a4f42a116cd272c6fb360ed51a9bc9e4ddd8f","confirmedAt":1790897226483,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":450000,"dueNowPYG":450000,"paidAmountPYG":450000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-0AB1548E","customer":"Celia rolón","paymentId":"44b00682-bec7-4fd7-9421-d6cd8897d8be","amountPYG":48000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-0AB1548E/8acfd6aa-c9f4-49d3-a30c-d3c8c7efd35f","receiptSha256":"940b1097d31fc6597e3a1a23806f5591f203907a0c04e7cf0d1ca8fd214a4415","confirmedAt":1790975440195,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":48000,"dueNowPYG":48000,"paidAmountPYG":48000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-1070A8FF","customer":"Sergio Golasik","paymentId":"7d831119-cf35-40ec-b9bf-e04971609940","amountPYG":90000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-1070A8FF/bfb38892-6cde-4040-8278-2f5dd2b14e1f","receiptSha256":"c8e2c4eb30ac39563b47878d66e829ceddca1693069c6b25021b8a8fab4ee78c","confirmedAt":1790948878489,"paymentType":"FULL","orderStatus":"PAID_IN_FULL","orderTotalPYG":90000,"dueNowPYG":22500,"paidAmountPYG":90000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-145136BC","customer":"Perla gonzalez","paymentId":"c0a3fd1d-9153-4a77-be55-e1f3baede88a","amountPYG":85000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-145136BC/7ba03ef8-8f05-459c-942e-2df94e206316","receiptSha256":"5534d261273c94aa04862142b45f32934a8f65efac341b14ed610fec538fe8a3","confirmedAt":1790966043290,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":85000,"dueNowPYG":85000,"paidAmountPYG":85000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-1CE93F99","customer":"Mariana Rodriguez","paymentId":"legacy-initial","amountPYG":100000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-1CE93F99/fd03f8e0-dd60-40f5-8f8a-3ac89f62b67b","receiptSha256":"e5a6e5e7bb4a15ab3315d2dc4c595d5456d4d29366635097bd27ab849584adb7","confirmedAt":1790892631153,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":400000,"dueNowPYG":100000,"paidAmountPYG":100000,"refundedAmountPYG":0,"remainingBalancePYG":300000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-1F6B26E6","customer":"Lissandri","paymentId":"legacy-initial","amountPYG":300000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-1F6B26E6/fa97b621-9417-4559-aa81-f5109800a0a7","receiptSha256":"2d6af1654726de33aa33d8a111d9dc727fc8735f6b02186d33cc73064ab08386","confirmedAt":1790898029660,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":1200000,"dueNowPYG":300000,"paidAmountPYG":300000,"refundedAmountPYG":0,"remainingBalancePYG":900000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-2E96F41C","customer":"Denilson Arguello","paymentId":"legacy-initial","amountPYG":110000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-2E96F41C/a55be784-567d-486f-8cdc-6c5a184cc116","receiptSha256":"ef53ecff338e8ef2591d287e095d076fb24a56ce9df25cdd8c457bd28de3c6c2","confirmedAt":1790889796532,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":110000,"dueNowPYG":110000,"paidAmountPYG":110000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-3B0BEA6E","customer":"Librado Valdez","paymentId":"056a3cde-c773-4fe7-a53e-2af02075e87d","amountPYG":10000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-3B0BEA6E/202ad14e-309f-45eb-af58-5ee19818c805","receiptSha256":"0f79566f8da6d8c6c94f204705591f22e4958d35dcda35506b1a774f28edc00a","confirmedAt":1791404434987,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":10000,"dueNowPYG":10000,"paidAmountPYG":10000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-3B2771C4","customer":"Virginia Villasboa","paymentId":"acb02908-1857-4dcf-a4fb-35de2f18e172","amountPYG":63000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-3B2771C4/cf6189c3-a1ea-4be5-8d59-ed83523ca605","receiptSha256":"a17c250c587d57ac6d0d317b57fd81f406e64e1a77cb0002d462a3b5f7592e3a","confirmedAt":1790957696490,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":63000,"dueNowPYG":63000,"paidAmountPYG":63000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":"VIRGINIA_SPLIT"},
  {"orderId":"VM-2026-3FE3DB31","customer":"Héctor Roa","paymentId":"legacy-initial","amountPYG":10000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-3FE3DB31/83d59278-26ec-4845-94d9-1b6f43e0de2b","receiptSha256":"d547246dbeb80393d46e723a8251250aaa2b51f9b7a1c8e4c1e7efad38d06a4c","confirmedAt":1790897088481,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":10000,"dueNowPYG":10000,"paidAmountPYG":10000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-414F1A63","customer":"Jae Gyu Um","paymentId":"187175ae-e20f-441a-a18b-bce2a360da35","amountPYG":50000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-414F1A63/80e976f5-8cac-4f5e-8c45-90b45c4a2820","receiptSha256":"b7a9d1f3d86981a02be836581cc9e109973aaed5843c56cc08289799159f3517","confirmedAt":1790971806827,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":50000,"dueNowPYG":50000,"paidAmountPYG":50000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-46615CE1","customer":"Luis Aquino","paymentId":"legacy-initial","amountPYG":150000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-46615CE1/97f3fed5-5c6c-4f27-a6a2-3435778af77c","receiptSha256":"b6fbb0c30a1fde50f36c1288e933f1e46aaf18815809c4bcb803154561c5c881","confirmedAt":1790894834025,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":150000,"dueNowPYG":150000,"paidAmountPYG":150000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-47C12FE9","customer":"Raquel Espinola","paymentId":"55dc5e65-e987-476d-aa04-4a4d2fd29ae3","amountPYG":25000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-47C12FE9/c8130e06-8315-438d-bea4-82eb8f0d18ad","receiptSha256":"eda078d3f78a6100b231276aacaa899aa9a606a4011c7047dd46574a91b43731","confirmedAt":1791248887779,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":25000,"dueNowPYG":25000,"paidAmountPYG":25000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-4CA32719","customer":"Marcelo Fernandez","paymentId":"legacy-initial","amountPYG":45000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-4CA32719/8e9199ba-d37f-4940-9b46-14284174c08c","receiptSha256":"ef95bf08d59bae930900af197c3f5b660d11d7749155cd27be7ec156c1eefe09","confirmedAt":1790890811983,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":180000,"dueNowPYG":45000,"paidAmountPYG":45000,"refundedAmountPYG":0,"remainingBalancePYG":135000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-56909BAE","customer":"Maria Estela","paymentId":"legacy-initial","amountPYG":30000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-56909BAE/a64dfb8c-4a2e-4775-848e-8f7258fac834","receiptSha256":"c24848fb868e41f4356e988a81c7f0e2b78dc50f3f955d7ff6a5153041c702da","confirmedAt":1790893338230,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":30000,"dueNowPYG":30000,"paidAmountPYG":30000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-5835508C","customer":"Graciela reichmann","paymentId":"52712b9d-d500-46d3-8710-bda3a62162ef","amountPYG":12000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-5835508C/31245f0f-eb69-4fff-ba5f-17ee0d3a8e1b","receiptSha256":"52e26c9ed6037e04c99b44e24471c4aaaa7833aed13fe0fa981fba8dd0173af2","confirmedAt":1790957435395,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":12000,"dueNowPYG":12000,"paidAmountPYG":12000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-584788D3","customer":"VIRGINIA VILLASBOA","paymentId":"8ae5ce77-b8b1-4642-835c-2efc92316d7a","amountPYG":1383250,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-584788D3/19c46fd6-1b3c-4d18-9a8c-239289e3f378","receiptSha256":"947880bfa44383364e9cda0ea4699ef7b782a16c39608f8941facfb2e8280a84","confirmedAt":1790957005421,"paymentType":"DEPOSIT","orderStatus":"PAID_IN_FULL","orderTotalPYG":1657000,"dueNowPYG":1383250,"paidAmountPYG":1657000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-584788D3","customer":"VIRGINIA VILLASBOA","paymentId":"72531bdb-30f3-492c-a63f-c3ddb94c0af3","amountPYG":273750,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-584788D3/368d46fa-c0eb-4ccb-a294-fc0f597db35b","receiptSha256":"9cb20ce9aada88535e4e5c95e26ecb580c18cf5cd1d6b653d1c7a820e819071c","confirmedAt":1790957733241,"paymentType":"FINAL","orderStatus":"PAID_IN_FULL","orderTotalPYG":1657000,"dueNowPYG":1383250,"paidAmountPYG":1657000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":"VIRGINIA_SPLIT"},
  {"orderId":"VM-2026-58963B65","customer":"Mariana Jacqueline Rodríguez","paymentId":"legacy-initial","amountPYG":200000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-58963B65/7fc1e857-4f59-42f3-9d12-88733cec6a9f","receiptSha256":"0fb82adf3cbfba586d707ad533417141d37e332f97ed4b63e6ac7a51e21d3cba","confirmedAt":1790892683088,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":200000,"dueNowPYG":200000,"paidAmountPYG":200000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-5B0EB9AE","customer":"Craig Young","paymentId":"legacy-initial","amountPYG":35000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-5B0EB9AE/1ddb96a8-663e-4c94-9419-9c13516ba35c","receiptSha256":"447be5b4956dc351870095c83d5ec65e31e99bc95144c29e71d2f5dad44aa93d","confirmedAt":1790895365436,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":140000,"dueNowPYG":35000,"paidAmountPYG":35000,"refundedAmountPYG":0,"remainingBalancePYG":105000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-70C642B9","customer":"Frederick Baumann","paymentId":"52204e2d-d231-4aa3-ae2e-460986d9a80f","amountPYG":125000,"expectedSource":"ABSENT","priority":true,"storageKey":"VM-2026-70C642B9/26a29725-eb9e-4697-a207-006201a2147a","receiptSha256":"f740bed34bd84b223e7bfd0a1872c1e916a49d33e188394e9781d32c26bc48f2","confirmedAt":1791410054160,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":500000,"dueNowPYG":125000,"paidAmountPYG":125000,"refundedAmountPYG":0,"remainingBalancePYG":375000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-70D9ED7B","customer":"Héctor Roa","paymentId":"legacy-initial","amountPYG":351500,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-70D9ED7B/2f669ed2-201b-4840-8229-6d6770a09385","receiptSha256":"7e8e05d2e48aac7829930fcf594ab571b6e28df8deaaa86324dba9375cd3add1","confirmedAt":1790893202064,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":914000,"dueNowPYG":351500,"paidAmountPYG":351500,"refundedAmountPYG":0,"remainingBalancePYG":562500,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-72DDF482","customer":"Gervasio Toledo","paymentId":"44d3b3a1-e157-4452-bc17-0b4904b9cfc9","amountPYG":35000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-72DDF482/ae191dbe-b84a-4517-ad5f-77c546458af1","receiptSha256":"ede02ac57f00cfae641b86fda3e62be807407e65d7700d27d9db625ddb9fb1e0","confirmedAt":1790965930610,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":35000,"dueNowPYG":35000,"paidAmountPYG":35000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-7AA9BCA5","customer":"Virginia Villasboa","paymentId":"1d1a5bd2-27c7-4a3f-ac21-d7e146ad5544","amountPYG":300000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-7AA9BCA5/1e2a3100-c8a1-4adc-9918-1c9a1f80f3d6","receiptSha256":"c7505e80001a5b30709fde11e93924df339c3896a8ec3b4552aa51a3147fce5b","confirmedAt":1791224205937,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":300000,"dueNowPYG":300000,"paidAmountPYG":300000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-867B8840","customer":"Debbey Brown","paymentId":"a3d082d5-2543-47ce-9352-426af313a008","amountPYG":140000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-867B8840/77e13e7a-9903-4de4-8d46-58c45bc3fdae","receiptSha256":"ec4bb9b40ca92b92d52479eba18b87aa423bf6fb8322745818dfc03d29f85d4b","confirmedAt":1791141996422,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":140000,"dueNowPYG":140000,"paidAmountPYG":140000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":"OWNER_CONFIRMED_ZELLE"},
  {"orderId":"VM-2026-8B07ABF4","customer":"Librado Valdez","paymentId":"legacy-initial","amountPYG":95000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-8B07ABF4/6e5da4f1-26d7-4230-a7fc-892ecabe76a7","receiptSha256":"b1d37a46c62bb2fa49d3da5948f207516222f98019a265ebb1aa8093a0f28871","confirmedAt":1790894790010,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":95000,"dueNowPYG":95000,"paidAmountPYG":95000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-8C169EBB","customer":"Flavia Pinto","paymentId":"legacy-initial","amountPYG":150000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-8C169EBB/e38a7bfe-8823-492a-9001-4bb175a015a8","receiptSha256":"2f0a3300500eff837f249e9b4fd520bbb72fea9249350bd354b8d86ee42bbeca","confirmedAt":1790889756563,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":150000,"dueNowPYG":150000,"paidAmountPYG":150000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-8F192AC2","customer":"Craig Young","paymentId":"legacy-initial","amountPYG":30000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-8F192AC2/ce68e501-7982-4d17-baf3-b6b3d70f028e","receiptSha256":"864d528c41b1fd23c8ae7bb6069944d03045788652dce1103f138524e75e9313","confirmedAt":1790892717792,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":120000,"dueNowPYG":30000,"paidAmountPYG":30000,"refundedAmountPYG":0,"remainingBalancePYG":90000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-8F32D765","customer":"Esilda Ortigoza","paymentId":"legacy-initial","amountPYG":180000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-8F32D765/9670fe13-c30e-4411-9b98-ae6853cb5b90","receiptSha256":"9d9e3f172d867307bd6ab073e27e94c80fe76bc35abf05bd14eabc3af88b8781","confirmedAt":1790890825418,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":180000,"dueNowPYG":180000,"paidAmountPYG":180000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-9B6FE636","customer":"Kevin Keen","paymentId":"65182b7a-de9b-4009-92c5-bd58e48bbbb7","amountPYG":118000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-9B6FE636/fc0310b7-8212-4522-9545-f67512064ec9","receiptSha256":"356c7208d4b47cb51f7f82783b5e9f4b92f4f371598b5aea74778e5a14b4e0de","confirmedAt":1790948783736,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":118000,"dueNowPYG":118000,"paidAmountPYG":118000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-9CC14872","customer":"Loida Ferreira","paymentId":"4958dadd-8472-43f9-9782-be2a42a643fd","amountPYG":175000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-9CC14872/f227cbb1-f380-498c-9048-25c927105e13","receiptSha256":"6a4db2011bb7f79b78a9249c9f6324c630d40d2005af4990a04c683af813028d","confirmedAt":1790944507612,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":175000,"dueNowPYG":175000,"paidAmountPYG":175000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-A5FCC901","customer":"Julio Olmedo","paymentId":"legacy-initial","amountPYG":100000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-A5FCC901/2e16a1e5-7a9d-462c-b21d-5bbd106d9e69","receiptSha256":"06755b1c97aeafd69e1f010eb3a9cb0dfc178eeb5796b728ec9fd5e3b767979f","confirmedAt":1790890587855,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":100000,"dueNowPYG":100000,"paidAmountPYG":100000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-AA7FED63","customer":"Kevin Keen","paymentId":"legacy-initial","amountPYG":965000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-AA7FED63/e38f0a03-88fe-49f4-af00-b0fd43d43a7e","receiptSha256":"e96af05b229917f33f012a31bd7ec9ec8ff27ec68a2e1a42accea83f9ca0a4e3","confirmedAt":1790897047055,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":965000,"dueNowPYG":965000,"paidAmountPYG":965000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-B32C135B","customer":"Daysi Zarate","paymentId":"legacy-initial","amountPYG":102000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-B32C135B/f8ccbfb0-efbb-4e7a-8c52-36d87c48a152","receiptSha256":"67d89bd76a8afd4d23f99202a3342fd96c0462aea427b653e38b05e5185852d9","confirmedAt":1790890842539,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":102000,"dueNowPYG":102000,"paidAmountPYG":102000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-B7B3CD5A","customer":"Raquel Borja","paymentId":"8ef459ba-2d84-4930-8551-fe923016a3a5","amountPYG":70000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-B7B3CD5A/09d623b8-d9b5-48b5-a999-2a51515c12a6","receiptSha256":"f653e263fb487a87a15ea755a867cd21948afe7e06f5fc0f4ecfbbc8556bb529","confirmedAt":1791388011728,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":70000,"dueNowPYG":70000,"paidAmountPYG":70000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-C00FBF96","customer":"Jazmin Yim","paymentId":"9ba41047-5394-4f75-9c84-63430b9ec4fe","amountPYG":106250,"expectedSource":"ABSENT","priority":true,"storageKey":"VM-2026-C00FBF96/70898fba-bb7a-4e30-9495-74061d8929f2","receiptSha256":"3cd09a3349a7a9b007fadec44cefa91bf144850c85cfc946b63d2bb44bc2bb0e","confirmedAt":1790971662362,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":425000,"dueNowPYG":106250,"paidAmountPYG":106250,"refundedAmountPYG":0,"remainingBalancePYG":318750,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-C6BBE5C9","customer":"Cándido Espinola","paymentId":"c7e71701-f15b-4ead-87ea-d2e47556bc2d","amountPYG":440000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-C6BBE5C9/f700249b-9a97-4804-9bdd-3e18117cedfd","receiptSha256":"b72164eecc4d4e278681a8cf9a279fd49ac61e266b82704cc61ff5790c6decdd","confirmedAt":1791388172946,"paymentType":"FULL","orderStatus":"PAID_IN_FULL","orderTotalPYG":440000,"dueNowPYG":110000,"paidAmountPYG":440000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-D274C527","customer":"Craig Young GB","paymentId":"legacy-initial","amountPYG":50000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-D274C527/7c2c81c8-8de3-433b-9824-9f014156dc34","receiptSha256":"b42521b5981417ab17f294cee682228e8d96dd8940fbc45cb9284d2aa19facba","confirmedAt":1790894862335,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":50000,"dueNowPYG":50000,"paidAmountPYG":50000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-D5CB8154","customer":"Odilia de Valdovino","paymentId":"df3e6cc6-4295-469f-8cc2-09a0d1cda5c6","amountPYG":35000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-D5CB8154/f957f2a8-0046-4f89-bfcf-072d72a72a7d","receiptSha256":"d15b12fe83c1408947a40b26cd493793c082b6968d4c9b9a8bb89f1052427401","confirmedAt":1790991999426,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":35000,"dueNowPYG":35000,"paidAmountPYG":35000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-D6AA4A15","customer":"Alice Riveros","paymentId":"e1301864-03f9-4b16-9337-20680b0b934c","amountPYG":220000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-D6AA4A15/f7772800-b281-4f7c-841d-cc695c46301f","receiptSha256":"d26f22b6b4cbe5089999a7372f533f3d18eb60d97a1d4aa5fdeabeb072ba2351","confirmedAt":1791247983742,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":220000,"dueNowPYG":220000,"paidAmountPYG":220000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-D882603B","customer":"Liza Anzoategui","paymentId":"legacy-initial","amountPYG":22000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-D882603B/cbf475a4-06e5-4b19-a78a-34dc6c0ea4e7","receiptSha256":"a9e5b6dc8a61e62818897e6eb949b3906b4d8cc0eb060c33b51a69db7255cccf","confirmedAt":1790889969012,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":22000,"dueNowPYG":22000,"paidAmountPYG":22000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-DA81F490","customer":"Francisca Cantero 0","paymentId":"68c83bdf-a67a-4e00-bfbc-a4c450fc3fd4","amountPYG":105000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-DA81F490/8ed3cda3-d2c3-4d07-b70b-ef8dec912a03","receiptSha256":"3891e6f2cc1aaebd3cd56b960de1e17ec537e8f682209e018f5039c5cb695860","confirmedAt":1791248699569,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":105000,"dueNowPYG":105000,"paidAmountPYG":105000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-E00AA2E0","customer":"Esilda Ortigoza","paymentId":"legacy-initial","amountPYG":60000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-E00AA2E0/5684ba42-47f4-4d54-82eb-7b545adc44f1","receiptSha256":"75beddf0e48d69a905eac54a4fed0fff2a32524198031560a7bedb5943ff8227","confirmedAt":1790894931704,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":60000,"dueNowPYG":60000,"paidAmountPYG":60000,"refundedAmountPYG":30000,"remainingBalancePYG":0,"adjustments":[{"id":"c739b410-2f15-4d18-9f46-b7f144171104","kind":"POST_SALE_PRICE_ADJUSTMENT","amountPYG":30000,"createdAt":1791433722891,"createdBy":"ADMIN","internalNote":"Reembolso parcial acordado con la clienta por reclamo sobre el artículo 142. Se devolvieron Gs. 30.000 de los Gs. 60.000 pagados originalmente."}],"specialKind":"PAYMENT_WITH_ADJUSTMENT"},
  {"orderId":"VM-2026-E1868AF3","customer":"Juan carlos Heredia","paymentId":"5884fbfa-13d7-471d-9467-4a713d1371a4","amountPYG":60000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-E1868AF3/b7d523ec-cdf0-456b-b193-1f02da0cc82e","receiptSha256":"4eb09f178b1f5ef929427359bcb6006ff90442904d2388715d4b5af4ae2ae81d","confirmedAt":1791251126250,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":60000,"dueNowPYG":60000,"paidAmountPYG":60000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-E22346C4","customer":"Sonia Cantero","paymentId":"617d54ef-b95e-4698-b19e-811f274d12b8","amountPYG":185000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-E22346C4/ee90fe4c-8490-45f9-8d28-c15f68f4dad8","receiptSha256":"204d1bc282a606c6235b4a3a6cceadc1f163eaac7b6992d8d6cde73a662706ca","confirmedAt":1791045422918,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":185000,"dueNowPYG":185000,"paidAmountPYG":185000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-E2C5FC7A","customer":"Johanna Saffi","paymentId":"legacy-initial","amountPYG":495000,"expectedSource":"LEGACY_ASSUMED","priority":true,"storageKey":"VM-2026-E2C5FC7A/b8103cc2-91c8-4912-a8eb-75b337bc40de","receiptSha256":"bc617495687a0c9fe700c4ae602a13bc228b6331f12c275b732c0a866b676659","confirmedAt":1790889823133,"paymentType":"DEPOSIT","orderStatus":"DEPOSIT_CONFIRMED","orderTotalPYG":630000,"dueNowPYG":495000,"paidAmountPYG":495000,"refundedAmountPYG":0,"remainingBalancePYG":135000,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-E4AD17AA","customer":"Julio Olmedo","paymentId":"legacy-initial","amountPYG":60000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-E4AD17AA/329f43a8-a029-4ab2-9ca2-cbc011c1c367","receiptSha256":"2b1c7c3e88e7fa255cff23565e02916fda5454f335efb144b1db2caee9be94fc","confirmedAt":1790888846520,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":60000,"dueNowPYG":60000,"paidAmountPYG":60000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-E7008633","customer":"Kevin Keen","paymentId":"legacy-initial","amountPYG":574000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-E7008633/f82671b2-4517-41b0-b341-9d656f2493fb","receiptSha256":"eb44a4a74e00d28dfdbb570a81b0f0e8a4f8d07aff23a5888e742f85b26de19e","confirmedAt":1790904396090,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":574000,"dueNowPYG":574000,"paidAmountPYG":574000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-EEFCDEF2","customer":"Carolina Trinchieri","paymentId":"legacy-initial","amountPYG":30000,"expectedSource":"LEGACY_ASSUMED","priority":false,"storageKey":"VM-2026-EEFCDEF2/1c80a348-cb7f-48b9-8ae0-780a344dc477","receiptSha256":"fc11b3626b8428ee1a6935d622ecbc76fc4814af801e0e527ba16ad7ffb0b82f","confirmedAt":1790891944223,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":30000,"dueNowPYG":30000,"paidAmountPYG":30000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
  {"orderId":"VM-2026-F976CF74","customer":"Raquel Martinez","paymentId":"d622c103-7085-4730-bc86-976ff67591b5","amountPYG":180000,"expectedSource":"ABSENT","priority":false,"storageKey":"VM-2026-F976CF74/a5516a58-83cb-4732-bd1b-60b636405f07","receiptSha256":"bed8f7663214f937cdbd9a461053b7475c9109380cd847f7c6f427885e9da2a0","confirmedAt":1790957517257,"paymentType":"FULL","orderStatus":"PAYMENT_CONFIRMED","orderTotalPYG":180000,"dueNowPYG":180000,"paidAmountPYG":180000,"refundedAmountPYG":0,"remainingBalancePYG":0,"adjustments":[],"specialKind":null},
];

export const LEGACY_RECONCILIATION_REVIEW_ALLOWLIST = Object.freeze(
  ENTRIES.map(entry => Object.freeze(entry))
);

const BY_KEY = new Map(LEGACY_RECONCILIATION_REVIEW_ALLOWLIST.map(entry => [
  keyFor(entry.orderId, entry.paymentId),
  entry,
]));

const BY_ORDER = new Map();
for (const entry of LEGACY_RECONCILIATION_REVIEW_ALLOWLIST) {
  const entries = BY_ORDER.get(entry.orderId) || [];
  entries.push(entry);
  BY_ORDER.set(entry.orderId, entries);
}

function reviewError(detail = LEGACY_REVIEW_STATE_CHANGED) {
  return Object.assign(new Error(detail), { status: 409 });
}

function assertReview(condition) {
  if (!condition) throw reviewError();
}

function formatPYG(amountPYG) {
  return String(amountPYG).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function legacyReviewKey(orderId, paymentId) {
  return keyFor(String(orderId || '').trim(), String(paymentId || '').trim());
}

export function legacyReviewEntry(orderId, paymentId) {
  return BY_KEY.get(legacyReviewKey(orderId, paymentId)) || null;
}

export function legacyReviewEntriesForOrder(orderId) {
  return [...(BY_ORDER.get(String(orderId || '').trim()) || [])];
}

export function orderedLegacyReviewEntries() {
  return [...LEGACY_RECONCILIATION_REVIEW_ALLOWLIST].sort((left, right) => {
    const sectionLeft = left.priority ? 0 : left.specialKind ? 2 : 1;
    const sectionRight = right.priority ? 0 : right.specialKind ? 2 : 1;
    return sectionLeft - sectionRight ||
      left.orderId.localeCompare(right.orderId) ||
      left.paymentId.localeCompare(right.paymentId);
  });
}

export function legacyReviewSection(entry) {
  if (entry.priority) return 'PRIORITY';
  if (entry.specialKind) return 'SPECIAL';
  return 'ORDINARY';
}

export function proposedLegacyReviewNote(entry) {
  switch (entry.specialKind) {
    case 'OWNER_CONFIRMED_CASH':
      return 'Pago recibido en efectivo por Gs. 238.000. Importe confirmado directamente por el vendedor. Reconciliado como ACTUAL_VERIFIED.';
    case 'VIRGINIA_SPLIT':
      return entry.orderId === 'VM-2026-584788D3'
        ? 'Transferencia única de Gs. 336.750 recibida de Virginia Villasboa. De ese total, Gs. 273.750 corresponden a este pedido y Gs. 63.000 al pedido VM-2026-3B2771C4. Asignación confirmada por el vendedor. Reconciliado como ACTUAL_VERIFIED.'
        : 'Transferencia única de Gs. 336.750 recibida de Virginia Villasboa. De ese total, Gs. 63.000 corresponden a este pedido y Gs. 273.750 al pedido VM-2026-584788D3. Asignación confirmada por el vendedor. Reconciliado como ACTUAL_VERIFIED.';
    case 'OWNER_CONFIRMED_ZELLE':
      return 'Pago recibido por Zelle por USD 50. Para este pedido se acordó y registró un valor de Gs. 140.000. Pago confirmado por el vendedor y reconciliado como ACTUAL_VERIFIED.';
    case 'PAYMENT_WITH_ADJUSTMENT':
      return 'Pago original de Gs. 60.000 confirmado contra el comprobante almacenado. El pedido tiene un ajuste/reembolso posterior separado de Gs. 30.000, ajuste c739b410-2f15-4d18-9f46-b7f144171104. El pago original permanece en Gs. 60.000. Reconciliado como ACTUAL_VERIFIED.';
    default:
      return `Comprobante almacenado revisado: transferencia PYG por Gs. ${formatPYG(entry.amountPYG)} a David Labossiere. El importe coincide con el monto histórico almacenado. Reconciliado como ACTUAL_VERIFIED.`;
  }
}

export function legacyReviewEvidenceLabel(entry) {
  switch (entry.specialKind) {
    case 'OWNER_CONFIRMED_CASH':
      return 'Confirmación directa del vendedor: pago en efectivo';
    case 'VIRGINIA_SPLIT':
      return 'Transferencia compartida y asignación confirmada por el vendedor';
    case 'OWNER_CONFIRMED_ZELLE':
      return 'Zelle USD 50; valor PYG acordado y confirmado por el vendedor';
    case 'PAYMENT_WITH_ADJUSTMENT':
      return 'Comprobante original; ajuste posterior separado';
    default:
      return 'Comprobante PYG auditado';
  }
}

export function legacyReviewRequiresReceiptValidation(entry) {
  return entry.specialKind !== 'OWNER_CONFIRMED_CASH';
}

export function paymentIsCompletedForReview(payment, entry) {
  return payment?.verificationStatus === 'CONFIRMED' &&
    payment?.voidedAt == null &&
    payment?.amountSource === 'LEGACY_RECONCILED' &&
    number(payment?.amountPYG) === entry.amountPYG &&
    number(payment?.legacyAssumedAmountPYG) === entry.amountPYG &&
    payment?.verifiedBy === 'ADMIN' &&
    payment?.reconciledBy === 'ADMIN';
}

function paymentIsOriginalReviewedState(payment, entry) {
  return payment?.verificationStatus === 'CONFIRMED' &&
    payment?.voidedAt == null &&
    rawSource(payment) === entry.expectedSource &&
    number(payment?.amountPYG) === entry.amountPYG;
}

function expectedAdjustments(entry) {
  return (entry.adjustments || []).map(adjustment => [
    adjustment.id,
    adjustment.kind,
    number(adjustment.amountPYG),
    normalizedTimestamp(adjustment.createdAt),
    adjustment.createdBy || null,
    adjustment.internalNote || '',
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function actualAdjustments(order) {
  return (order?.paymentAdjustments || []).map(adjustment => [
    adjustment.id,
    adjustment.kind,
    number(adjustment.amountPYG),
    normalizedTimestamp(adjustment.createdAt),
    adjustment.createdBy || null,
    adjustment.internalNote || '',
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

export function validateAllowlistedLegacyOrder(order, targetEntry, {
  allowTargetCompleted = false,
} = {}) {
  assertReview(order?.id === targetEntry.orderId);
  assertReview(order?.buyer?.name === targetEntry.customer);
  assertReview(order?.status === targetEntry.orderStatus);
  assertReview(number(order?.totals?.totalPYG) === targetEntry.orderTotalPYG);
  assertReview(number(order?.totals?.dueNowPYG) === targetEntry.dueNowPYG);
  assertReview(number(order?.paidAmountPYG) === targetEntry.paidAmountPYG);
  assertReview(number(order?.refundedAmountPYG) === targetEntry.refundedAmountPYG);
  assertReview(number(order?.remainingBalancePYG) === targetEntry.remainingBalancePYG);

  const expectedPayments = legacyReviewEntriesForOrder(targetEntry.orderId);
  const payments = Array.isArray(order?.payments) ? order.payments : [];
  assertReview(payments.length === expectedPayments.length);

  for (const expected of expectedPayments) {
    const payment = payments.find(candidate => candidate.id === expected.paymentId);
    assertReview(Boolean(payment));
    assertReview(payment.type === expected.paymentType);
    assertReview(payment.paymentMethod === 'BANK_TRANSFER');
    assertReview(normalizedTimestamp(payment.confirmedAt) === expected.confirmedAt);
    assertReview(payment?.receipt?.storageKey === expected.storageKey);

    const isTarget = expected.paymentId === targetEntry.paymentId;
    const original = paymentIsOriginalReviewedState(payment, expected);
    const completed = paymentIsCompletedForReview(payment, expected);
    assertReview(isTarget
      ? original || (allowTargetCompleted && completed)
      : original || completed);
  }

  assertReview(JSON.stringify(actualAdjustments(order)) ===
    JSON.stringify(expectedAdjustments(targetEntry)));
  return order;
}

const VIRGINIA_ENTRIES = Object.freeze([
  legacyReviewEntry('VM-2026-584788D3', '72531bdb-30f3-492c-a63f-c3ddb94c0af3'),
  legacyReviewEntry('VM-2026-3B2771C4', 'acb02908-1857-4dcf-a4fb-35de2f18e172'),
]);

export function legacyReviewContextEntries(entry) {
  return entry.specialKind === 'VIRGINIA_SPLIT' ? [...VIRGINIA_ENTRIES] : [entry];
}

export function validateAllowlistedLegacyContext(ordersById, targetEntry, {
  allowTargetCompleted = false,
} = {}) {
  validateAllowlistedLegacyOrder(
    ordersById.get(targetEntry.orderId),
    targetEntry,
    { allowTargetCompleted }
  );
  if (targetEntry.specialKind === 'VIRGINIA_SPLIT') {
    for (const related of VIRGINIA_ENTRIES) {
      if (related.orderId === targetEntry.orderId) continue;
      validateAllowlistedLegacyOrder(
        ordersById.get(related.orderId),
        related,
        { allowTargetCompleted: true }
      );
      const relatedPayment = ordersById.get(related.orderId)?.payments
        ?.find(payment => payment.id === related.paymentId);
      assertReview(paymentIsOriginalReviewedState(relatedPayment, related) ||
        paymentIsCompletedForReview(relatedPayment, related));
    }
  }
  return true;
}

export function validateLegacyReviewReceipt(entry, encodedReceipt) {
  assertReview(typeof encodedReceipt === 'string' && encodedReceipt.length > 0);
  const digest = createHash('sha256')
    .update(Buffer.from(encodedReceipt, 'base64'))
    .digest('hex');
  assertReview(digest === entry.receiptSha256);
  return true;
}
