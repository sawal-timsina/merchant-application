const originalFetch = window.fetch;

window.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url = typeof input === 'string' ? input : input.url;

  if (url.includes('/auth/login') && response.ok) {
    const { accessToken } = await response.clone().json();
    if (accessToken) window.ui.preauthorizeApiKey('bearer', accessToken);
  }

  return response;
};
