document.getElementById('saveBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.tabs.sendMessage(tab.id, { action: 'save' }, (response) => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: showToast,
        args: ['SoulArchive.AI: 未対応のページです']
      });
      window.close();
      return;
    }

    if (response && response.markdown) {
      downloadMarkdown(response.markdown, response.pageTitle || 'Untitled');
    }
    // toast 系の応答（開発中 / 未対応）は content.js 側で処理済み
    window.close();
  });
});

function downloadMarkdown(content, pageTitle) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // ファイル名サニタイズ: \/:*?"<>| → -、連続空白→1つ、先頭末尾の空白とドット除去、最大80文字
  let safeTitle = pageTitle
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80) || 'Untitled';
  const filename = `${safeTitle}_${datePart}-${timePart}.txt`;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const reader = new FileReader();
  reader.onload = (e) => {
    chrome.downloads.download({ url: e.target.result, filename, saveAs: false });
  };
  reader.readAsDataURL(blob);
}

// 未対応ページ向けにスクリプト注入で呼ぶトースト関数
function showToast(message) {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '12px 24px',
    borderRadius: '8px', fontSize: '14px', fontFamily: 'sans-serif',
    zIndex: '2147483647', opacity: '0', transition: 'opacity 0.3s'
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}
