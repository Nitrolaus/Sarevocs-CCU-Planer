import { createHash } from 'node:crypto';

// Wire fixture from the public RSI sign-in client. Derive the APQ ID independently
// from its printed document so a changed hash or fallback document fails the test.
export const imageQuery = `mutation captcha($action: String!, $size: String!) {
  account_captcha(action: $action, size: $size) {
    data
    type
    encoding
    __typename
  }
}`;
export const imageOperation = {
  operationName: 'captcha',
  variables: { size: 'm', action: 'signin' },
  extensions: { persistedQuery: { version: 1, sha256Hash: createHash('sha256').update(imageQuery).digest('hex') } },
};
export const persistedImageBody = JSON.stringify([imageOperation]);
export const fallbackImageBody = JSON.stringify([{ ...imageOperation, query: imageQuery }]);

export const confirmationQuery = `mutation signin($captcha_code: String, $captchaToken: String, $email: String!, $mark: String, $password: String!, $remember: Boolean) {
  account_signin(
    captcha_code: $captcha_code
    captcha_token: $captchaToken
    email: $email
    mark: $mark
    password: $password
    remember: $remember
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
export const confirmationOperation = {
  operationName: 'signin',
  variables: {
    email: 'local-confirmation@example.invalid',
    password: 'synthetic-password-only',
    mark: 'synthetic-mark-only',
    remember: true,
    captcha_code: '42AB67',
  },
  extensions: { persistedQuery: { version: 1, sha256Hash: createHash('sha256').update(confirmationQuery).digest('hex') } },
};
export const persistedConfirmationBody = JSON.stringify([confirmationOperation]);
export const fallbackConfirmationBody = JSON.stringify([{ ...confirmationOperation, query: confirmationQuery }]);
