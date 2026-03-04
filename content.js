// ─────────────────────────────────────────────
//  SoulArchive — content.js
//  ChatGPT DOM → Markdown 変換 & ドメイン判定
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action !== 'save') return;

    const host = location.hostname;

    // ── ChatGPT ──
    if (host === 'chatgpt.com' || host === 'www.chatgpt.com') {
        sendResponse({ markdown: extractConversation() });
        return true;
    }

    // ── 開発中サービス ──
    if (host.includes('gemini.google.com') || host.includes('claude.ai')) {
        showToast('SoulArchive: 現在開発中です');
        sendResponse({ status: 'wip' });
        return true;
    }

    // ── 未対応 ──
    showToast('SoulArchive: 未対応のページです');
    sendResponse({ status: 'unsupported' });
    return true;
});

// ═══════════════════════════════════════════════
//  Toast 通知
// ═══════════════════════════════════════════════
function showToast(message) {
    const el = document.createElement('div');
    el.textContent = message;
    Object.assign(el.style, {
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        zIndex: '2147483647',
        opacity: '0',
        transition: 'opacity 0.3s ease',
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ═══════════════════════════════════════════════
//  会話抽出
// ═══════════════════════════════════════════════
function extractConversation() {
    const turns = document.querySelectorAll('[data-testid^="conversation-turn-"]');
    const blocks = [];

    turns.forEach((turn, i) => {
        const roleEl = turn.querySelector('[data-message-author-role]');
        const role = roleEl ? roleEl.getAttribute('data-message-author-role') : null;
        const isUser = role ? role === 'user' : i % 2 === 0;

        const label = isUser ? 'ユーザー:' : 'ChatGPT:';

        // ユーザー発言は .whitespace-pre-wrap、AI発言は .markdown を優先的に探す
        let contentRoot;
        if (isUser) {
            contentRoot = turn.querySelector('.whitespace-pre-wrap') || turn;
        } else {
            contentRoot = turn.querySelector('.markdown') || turn;
        }

        const md = nodeToMarkdown(contentRoot).trim();
        if (md) blocks.push(`${label}\n${md}`);
    });

    return blocks.join('\n\n=====\n\n') + '\n';
}

// ═══════════════════════════════════════════════
//  DOM → Markdown 変換
// ═══════════════════════════════════════════════

/**
 * ルートノードを受け取り、Markdown 文字列を返す。
 * 方針: ブロック要素ごとに「行の配列」を組み立て、最後に join する。
 */
function nodeToMarkdown(root) {
    const lines = processChildren(root);
    // 3行以上の連続空行を2行（= 空行1つ）に圧縮
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 子ノードを順に処理し、行の配列として返す。
 */
function processChildren(parent) {
    const lines = [];
    for (const child of parent.childNodes) {
        const result = processNode(child);
        if (result !== null) {
            lines.push(result);
        }
    }
    return lines;
}

/**
 * 単一ノードを処理し、対応する Markdown 文字列を返す。
 */
function processNode(node) {
    // ── テキストノード ──
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue;
    }

    // ── 要素ノード以外は無視 ──
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();

    // 不要な要素をスキップ
    if (['button', 'svg', 'style', 'script', 'nav'].includes(tag)) return null;

    // ── コードブロック (<pre>) ──
    if (tag === 'pre') {
        return handlePre(node);
    }

    // ── 見出し ──
    if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = inlineText(node);
        return '\n' + '#'.repeat(level) + ' ' + text + '\n';
    }

    // ── 段落 ──
    if (tag === 'p') {
        const text = inlineText(node);
        return text + '\n';
    }

    // ── 箇条書きリスト ──
    if (tag === 'ul') {
        return '\n' + handleList(node, 'ul') + '\n';
    }

    // ── 番号付きリスト ──
    if (tag === 'ol') {
        return '\n' + handleList(node, 'ol') + '\n';
    }

    // ── 改行 ──
    if (tag === 'br') {
        return '\n';
    }

    // ── インラインコード (pre の外) ──
    if (tag === 'code') {
        return '`' + node.textContent + '`';
    }

    // ── 太字 ──
    if (tag === 'strong' || tag === 'b') {
        return '**' + inlineText(node) + '**';
    }

    // ── 斜体 ──
    if (tag === 'em' || tag === 'i') {
        return '*' + inlineText(node) + '*';
    }

    // ── リンク ──
    if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        return '[' + inlineText(node) + '](' + href + ')';
    }

    // ── テーブル ──
    if (tag === 'table') {
        return '\n' + handleTable(node) + '\n';
    }

    // ── 汎用コンテナ (div, span 等) ──
    return processChildren(node).join('');
}

// ─── コードブロック ───
function handlePre(preNode) {
    const codeEl = preNode.querySelector('code');
    if (codeEl) {
        const langMatch = (codeEl.className || '').match(/language-(\S+)/);
        const lang = langMatch ? langMatch[1] : '';
        return '\n```' + lang + '\n' + codeEl.textContent + '\n```\n';
    }
    return '\n```\n' + preNode.textContent + '\n```\n';
}

// ─── リスト ───
function handleList(listNode, type) {
    const items = [];
    let index = 1;

    for (const li of listNode.children) {
        if (li.tagName.toLowerCase() !== 'li') continue;

        // li 内のテキストを一行にまとめる（p タグ等の余計な改行を除去）
        const text = inlineText(li).replace(/\n/g, ' ').trim();
        const prefix = type === 'ol' ? `${index}. ` : '- ';
        items.push(prefix + text);
        index++;
    }

    return items.join('\n');
}

// ─── テーブル ───
function handleTable(tableNode) {
    const rows = tableNode.querySelectorAll('tr');
    if (rows.length === 0) return '';

    const result = [];

    rows.forEach((row, rowIdx) => {
        const cells = row.querySelectorAll('th, td');
        const cellTexts = Array.from(cells).map(c => inlineText(c).replace(/\n/g, ' ').trim());
        result.push('| ' + cellTexts.join(' | ') + ' |');

        // ヘッダー行の後に区切り行を挿入
        if (rowIdx === 0) {
            result.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
        }
    });

    return result.join('\n');
}

// ─── インラインテキスト抽出 ───
// ブロック要素の子をインラインとして結合し、装飾を維持するヘルパー。
function inlineText(node) {
    let out = '';

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            out += child.nodeValue;
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName.toLowerCase();
        if (['button', 'svg', 'style', 'script'].includes(tag)) continue;

        if (tag === 'strong' || tag === 'b') {
            out += '**' + inlineText(child) + '**';
        } else if (tag === 'em' || tag === 'i') {
            out += '*' + inlineText(child) + '*';
        } else if (tag === 'code') {
            out += '`' + child.textContent + '`';
        } else if (tag === 'a') {
            out += '[' + inlineText(child) + '](' + (child.getAttribute('href') || '') + ')';
        } else if (tag === 'br') {
            out += '\n';
        } else {
            // p, div, span 等の中身をそのまま結合
            out += inlineText(child);
        }
    }

    return out;
}
