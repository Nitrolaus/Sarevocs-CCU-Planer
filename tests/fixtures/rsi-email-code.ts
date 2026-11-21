import { createHash } from 'node:crypto';

// The published RSI client uses the same APQ ID for its full-document retry.
export const emailCodeQuery = `mutation multistep($code: String!, $deviceType: String!, $deviceName: String!, $duration: String!) {
  account_multistep(
    code: $code
    device_type: $deviceType
    device_name: $deviceName
    duration: $duration
  ) {
    ...AuthUserFragment
    __typename
  }
}

fragment AuthUserFragment on RsiAuthenticatedAccount {
  avatar
  displayname
  email
  hasGameAccess
  hasGamePackage
  referrerReferralCode
  status
  tmid
  username
  syncToken
  __typename
}`;
export const emailCodeOperation = {
  operationName: 'multistep',
  variables: { code: 'T35T42', deviceName: 'Synthetischer Prüf-PC', deviceType: 'computer', duration: 'session' },
  extensions: { persistedQuery: { version: 1, sha256Hash: createHash('sha256').update(emailCodeQuery).digest('hex') } },
};
export const persistedEmailCodeBody = JSON.stringify([emailCodeOperation]);
export const fallbackEmailCodeBody = JSON.stringify([{ ...emailCodeOperation, query: emailCodeQuery }]);

export const passwordEyeUrls = [
  'https://cdn.robertsspaceindustries.com/orion-v3/icons/visibility-ecc8b45b.svg',
  'https://cdn.robertsspaceindustries.com/orion-v3/icons/visibilityOff-d487fc6e.svg',
];
