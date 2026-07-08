(function () {
  'use strict';

  function sendToExtension(data) {
    window.postMessage({ source: 'echotik-exporter', type: 'captured', data }, '*');
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0];
    if (typeof url === 'string' && url.includes('/api/v1/data/influencers?')) {
      try {
        const clone = response.clone();
        const json = await clone.json();
        if (json && json.code === 0 && Array.isArray(json.data)) {
          sendToExtension(json.data);
        }
      } catch (e) {
        // ignore
      }
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (typeof this._url === 'string' && this._url.includes('/api/v1/data/influencers?')) {
        try {
          const json = JSON.parse(this.responseText);
          if (json && json.code === 0 && Array.isArray(json.data)) {
            sendToExtension(json.data);
          }
        } catch (e) {
          // ignore
        }
      }
    });
    return originalSend.apply(this, args);
  };
})();
