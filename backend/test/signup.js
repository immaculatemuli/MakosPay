// Signs a passenger up the way the app does: the SMS code first (shown in the answer while SMS is in test mode),
// then the account with it. `api` is the test file's own request helper.
export async function signUp(api, body) {
  const sent = await api('POST', '/auth/register/code', { body: { phone: body.phone } });
  return api('POST', '/auth/register', { body: { ...body, code: sent.body?.test_code } });
}
