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
