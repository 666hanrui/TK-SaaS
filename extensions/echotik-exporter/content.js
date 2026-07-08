(function () {
  'use strict';

  const STORAGE_KEY = 'echotik_influencers_export';
  let captured = [];
  let panel = null;

  function loadStored() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        captured = JSON.parse(raw);
      }
    } catch (e) {
      captured = [];
    }
  }

  function saveStored() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(captured));
    } catch (e) {
      // ignore
    }
  }

  function addRecord(items) {
    if (!Array.isArray(items)) return;
    let added = 0;
    for (const item of items) {
      if (!item || !item.influencer_id) continue;
      const exists = captured.some((c) => c.influencer_id === item.influencer_id);
      if (!exists) {
        captured.push(item);
        added++;
      }
    }
    if (added > 0) {
      saveStored();
      updatePanel();
      setStatus(`新增 ${added} 条，共 ${captured.length} 条`);
    }
  }

  function normalizeValue(value) {
    if (value === null || value === undefined || value === 'N/A') return '';
    return String(value).trim();
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === 'N/A') return null;
    const text = String(value).replace(/[$,]/g, '').toLowerCase().trim();
    const suffixMatch = text.match(/^(-?\d+(?:\.\d+)?)\s*([kmb万])?$/i);
    if (suffixMatch) {
      const number = Number(suffixMatch[1]);
      const suffix = suffixMatch[2];
      const multiplier =
        suffix === 'k' ? 1000 :
        suffix === 'm' ? 1000000 :
        suffix === '万' ? 10000 :
        suffix === 'b' ? 1000000000 : 1;
      return Math.round(number * multiplier);
    }
    const fallback = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(fallback) ? fallback : null;
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toJSON(data) {
    return JSON.stringify(data, null, 2);
  }

  function toCSV(data) {
    if (data.length === 0) return '';

    const headers = [
      'User Id',
      '达人名称',
      'Unique Id',
      '地区',
      '主打带货品类',
      '联系邮箱',
      '社交账号',
      '粉丝数',
      '30天涨粉数',
      '点赞数/粉丝数',
      '视频数',
      '视频销售额($)',
      '平均播放量(近30天)',
      '直播数',
      '直播销售额($)',
      '观看人数',
      '带货商品数',
      'ER互动率',
      '销量',
      '销售额($)',
      '近30天GMV($)',
      '近30天播放量',
      '近30天点赞数',
      '性别',
      '来源',
    ];

    const rows = data.map((item) => {
      const genderMap = { male: '男', female: '女' };
      const gender = normalizeValue(item.gender);
      return [
        normalizeValue(item.influencer_id),
        normalizeValue(item.influencer_name),
        normalizeValue(item.unique_id) ? '@' + normalizeValue(item.unique_id) : '',
        normalizeValue(item.region),
        normalizeValue(item.category_product || item.category),
        normalizeValue(item.is_email) === '1' ? '企业版可导出' : '',
        '', // 社交账号
        parseNumber(item.follower_count) ?? '',
        parseNumber(item.follower_30d_count) ?? '',
        parseNumber(item.likes_per_followers) ?? '',
        parseNumber(item.video_count) ?? '',
        parseNumber(item.sales) ?? '',
        parseNumber(item.views_per_video_30d) ?? '',
        parseNumber(item.live_count) ?? '',
        '', // 直播销售额
        '', // 观看人数
        parseNumber(item.total_product_cnt) ?? '',
        parseNumber(item.engagement_rate) ?? '',
        parseNumber(item.sales) ?? '',
        parseNumber(item.gmv) ?? '',
        parseNumber(item.gmv_amt_30d) ?? '',
        parseNumber(item.views) ?? '',
        parseNumber(item.heart_count) ?? '',
        genderMap[gender] || gender,
        'EchoTik Web 导出',
      ];
    });

    const escape = (value) => {
      const text = String(value ?? '');
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    };

    return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
  }

  function updatePanel() {
    if (!panel) return;
    const countEl = panel.querySelector('.echotik-export-count');
    if (countEl) {
      countEl.textContent = `已捕获 ${captured.length} 条`;
    }
  }

  function setStatus(message) {
    if (!panel) return;
    const statusEl = panel.querySelector('.echotik-export-status');
    if (statusEl) {
      statusEl.textContent = message;
      setTimeout(() => {
        statusEl.textContent = '';
      }, 4000);
    }
  }

  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'echotik-export-panel';
    panel.innerHTML = `
      <div class="echotik-export-header">
        <strong>EchoTik 导出助手</strong>
        <span class="echotik-export-count">已捕获 0 条</span>
      </div>
      <div class="echotik-export-body">
        <button class="echotik-export-btn" data-action="clear">清空</button>
        <button class="echotik-export-btn primary" data-action="json">导出 JSON</button>
        <button class="echotik-export-btn primary" data-action="csv">导出 CSV</button>
      </div>
      <div class="echotik-export-status"></div>
    `;

    panel.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', handleAction);
    });

    document.body.appendChild(panel);
    updatePanel();
  }

  function handleAction(event) {
    const action = event.target.dataset.action;

    if (action === 'clear') {
      captured = [];
      saveStored();
      updatePanel();
      setStatus('已清空');
      return;
    }

    if (action === 'json') {
      if (captured.length === 0) {
        setStatus('暂无数据，请先翻页或筛选');
        return;
      }
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadFile(toJSON(captured), `echotik-influencers-${captured.length}-${timestamp}.json`, 'application/json');
      setStatus(`已导出 ${captured.length} 条 JSON`);
      return;
    }

    if (action === 'csv') {
      if (captured.length === 0) {
        setStatus('暂无数据，请先翻页或筛选');
        return;
      }
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadFile(toCSV(captured), `echotik-influencers-${captured.length}-${timestamp}.csv`, 'text/csv;charset=utf-8;');
      setStatus(`已导出 ${captured.length} 条 CSV`);
      return;
    }
  }

  function injectInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.type = 'text/javascript';
    script.onload = function () {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function init() {
    loadStored();
    injectInterceptor();

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.source === 'echotik-exporter' && event.data.type === 'captured') {
        addRecord(event.data.data);
      }
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createPanel);
    } else {
      createPanel();
    }
  }

  init();
})();
