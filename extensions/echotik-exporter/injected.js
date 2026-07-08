(function () {
  'use strict';

  let autoFetching = false;

  function sendToExtension(data) {
    window.postMessage({ source: 'echotik-exporter', type: 'captured', data }, '*');
  }

  function sendProgress(message) {
    window.postMessage({ source: 'echotik-exporter', type: 'progress', message }, '*');
  }

  function sendComplete(message) {
    window.postMessage({ source: 'echotik-exporter', type: 'complete', message }, '*');
  }

  function buildApiUrl(pageUrl, page) {
    const url = new URL(pageUrl);
    const apiUrl = new URL('/api/v1/data/influencers', url.origin);

    const relevantParams = [
      'per_page',
      'influencer_categories',
      'product_categories',
      'show_case',
      'is_email',
      'is_seller',
      'sales_flag',
      'order',
      'sort',
      'gender',
      'contact',
      'follower_genders',
      'follower_ages',
      'language',
      'inlfuencer_type',
    ];

    for (const param of relevantParams) {
      if (url.searchParams.has(param)) {
        apiUrl.searchParams.set(param, url.searchParams.get(param));
      }
    }

    apiUrl.searchParams.set('page', String(page));
    return apiUrl.toString();
  }

  function getCurrentPage(pageUrl) {
    const url = new URL(pageUrl);
    const page = parseInt(url.searchParams.get('page'), 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  async function fetchPages(baseUrl, pages) {
    if (autoFetching) return;
    autoFetching = true;

    const startPage = getCurrentPage(baseUrl) + 1;
    const seenIds = new Set();
    let totalNew = 0;
    let totalDup = 0;

    try {
      for (let offset = 0; offset < pages; offset++) {
        const page = startPage + offset;
        const url = buildApiUrl(baseUrl, page);
        sendProgress(`正在采集第 ${page} 页...`);
        console.log(`[EchoTik Exporter] fetching ${url}`);

        const response = await fetch(url, {
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            'x-region': 'US',
            'x-lang': 'zh-CN',
            'x-currency': 'USD',
            'x-secondary-currency': 'CNY',
          },
          credentials: 'include',
        });

        console.log(`[EchoTik Exporter] page ${page} status ${response.status}`);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          sendComplete(`第 ${page} 页返回非 JSON（状态 ${response.status}），自动采集结束`);
          console.error('[EchoTik Exporter] non-JSON response:', text.slice(0, 500));
          break;
        }

        const json = await response.json();

        if (json && json.code === 50001) {
          sendComplete(`EchoTik 会员限制：${json.msg || '已超出该功能使用限制'}。请升级会员或减少采集页数。`);
          console.error('[EchoTik Exporter] membership limit:', json);
          break;
        }

        if (json && Array.isArray(json.data)) {
          let pageNew = 0;
          let pageDup = 0;
          for (const item of json.data) {
            if (!item || !item.influencer_id) continue;
            if (seenIds.has(item.influencer_id)) {
              pageDup++;
            } else {
              seenIds.add(item.influencer_id);
              pageNew++;
            }
          }
          totalNew += pageNew;
          totalDup += pageDup;

          sendToExtension(json.data);
          sendProgress(`第 ${page} 页: ${json.data.length} 条（新增 ${pageNew} / 重复 ${pageDup}）`);
          console.log(`[EchoTik Exporter] page ${page} total=${json.data.length} new=${pageNew} dup=${pageDup} code=${json.code}`);

          if (json.data.length === 0) {
            sendComplete(`第 ${page} 页无数据，自动采集结束。累计新增 ${totalNew} 条，重复 ${totalDup} 条。`);
            break;
          }
        } else {
          sendComplete(`第 ${page} 页返回异常（code=${json?.code}），自动采集结束`);
          console.error('[EchoTik Exporter] unexpected response:', json);
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000));
      }

      sendComplete(`自动采集完成。累计新增 ${totalNew} 条，重复 ${totalDup} 条。`);
    } catch (error) {
      sendComplete(`自动采集出错: ${error.message}`);
      console.error('[EchoTik Exporter] auto fetch error:', error);
    } finally {
      autoFetching = false;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'echotik-exporter') return;

    if (event.data.type === 'auto-fetch') {
      const baseUrl = event.data.baseUrl || window.location.href;
      fetchPages(baseUrl, event.data.pages || 3);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0];
        if (typeof url === 'string' && url.includes('/api/v1/data/influencers?')) {
          try {
            const clone = response.clone();
            const json = await clone.json();
            if (json && Array.isArray(json.data)) {
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
            if (json && Array.isArray(json.data)) {
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
