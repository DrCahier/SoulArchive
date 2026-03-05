// ─────────────────────────────────────────────
//  SoulArchive.AI v1.1 — content.js
//  ChatGPT DOM → Markdown 変換 & ドメイン判定
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req.action !== 'save') return;

    const host = location.hostname;

    // ── ChatGPT ──
    if (host === 'chatgpt.com' || host === 'www.chatgpt.com') {
        const pageTitle = document.title || 'Untitled';
        sendResponse({
            markdown: extractConversation(pageTitle),
            pageTitle: pageTitle,
        });
        return true;
    }

    // ── 開発中サービス ──
    if (host.includes('gemini.google.com') || host.includes('claude.ai')) {
        showToast('SoulArchive.AI: 現在開発中です');
        sendResponse({ status: 'wip' });
        return true;
    }

    // ── 未対応 ──
    showToast('SoulArchive.AI: 未対応のページです');
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
// コードブロック保護用ストア（ターンごとにリセット）
let _codeBlockStore = [];

/** プレースホルダを元のコードブロックに復元する */
function restoreCodeBlocks(text) {
    return text.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => {
        return _codeBlockStore[parseInt(idx, 10)];
    });
}

/**
 * ユーザー発言用: CodeMirror DOM (span+br連なり) から改行を正確に復元する。
 * - SPAN / テキストノード → textContent をそのまま追加
 * - BR → \n を追加（連続BRはそのまま連続 \n）
 * - ノード間に勝手にスペースを挿入しない
 * - innerText / textContent による一括取得は禁止
 */
function extractPlainText(root) {
    let out = '';

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.nodeValue;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName.toLowerCase();

        // 不要な要素をスキップ
        if (['button', 'svg', 'style', 'script', 'nav'].includes(tag)) return;

        // BR → 改行1つ（連続BRはそのまま連続\n）
        if (tag === 'br') {
            out += '\n';
            return;
        }

        // それ以外は子ノードを順に走査
        for (const child of node.childNodes) {
            walk(child);
        }
    }

    walk(root);
    return out;
}

function extractConversation(pageTitle) {
    const turns = document.querySelectorAll('[data-testid^="conversation-turn-"]');
    const blocks = [];

    turns.forEach((turn, i) => {
        const roleEl = turn.querySelector('[data-message-author-role]');
        const role = roleEl ? roleEl.getAttribute('data-message-author-role') : null;
        const isUser = role ? role === 'user' : i % 2 === 0;

        const label = isUser ? 'ユーザー:' : 'ChatGPT:';

        let contentRoot;
        if (isUser) {
            contentRoot = turn.querySelector('.whitespace-pre-wrap') || turn;
        } else {
            contentRoot = turn.querySelector('.markdown') || turn;
        }

        // ターンごとにストアをリセット
        _codeBlockStore = [];

        let md;
        if (isUser) {
            // ユーザー発言: CodeMirror DOM (span+br) から改行を正確に復元
            md = extractPlainText(contentRoot);
        } else {
            // AI発言: ブロック要素のMarkdown変換パイプライン
            md = convertNode(contentRoot);
            md = normalize(md);
            md = restoreCodeBlocks(md);
        }

        const text = md.trim();
        if (text) blocks.push(`${label}\n${text}`);
    });

    const body = blocks.join('\n\n---\n\n');

    // 末尾メタ情報
    const savedAt = toJSTISO(new Date());
    const meta = [
        '---',
        '',
        'Note:',
        `- URL: ${location.href}`,
        `- Title: ${pageTitle}`,
        '- Service: ChatGPT',
        `- SavedAt: ${savedAt}`,
    ].join('\n');

    return `# ${pageTitle}\n\n${body}\n\n${meta}\n`;
}

/** JST の ISO 8601 文字列を生成 */
function toJSTISO(date) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(jst.getUTCDate()).padStart(2, '0');
    const h = String(jst.getUTCHours()).padStart(2, '0');
    const mi = String(jst.getUTCMinutes()).padStart(2, '0');
    const s = String(jst.getUTCSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

// ═══════════════════════════════════════════════
//  正規化
//  コードブロックは handlePre で既にプレースホルダ化済み。
//  ここではプレースホルダ行を一切触らずにテキスト整形だけを行う。
// ═══════════════════════════════════════════════
function normalize(text) {
    // 行単位で処理
    let lines = text.split('\n');
    lines = lines.map(line => {
        // プレースホルダ行はそのまま保護
        if (line.includes('%%CODEBLOCK_')) return line;
        // 空白だけの行を除去
        if (/^\s+$/.test(line)) return '';
        return line;
    });
    text = lines.join('\n');

    // 3行以上の連続空行 → 空行1つに圧縮
    text = text.replace(/\n{3,}/g, '\n\n');

    // ␠␠\n\n を作らない → ␠␠\n に修正
    text = text.replace(/  \n\n/g, '  \n');

    return text.trim();
}

// ═══════════════════════════════════════════════
//  DOM → Markdown 変換
//
//  手順:
//   1. <pre> を見つけたら中身をそのまま保護
//   2. <br> を見つけたら即 ␠␠\n を挿入
//   3. <p> の終了で \n\n を挿入
// ═══════════════════════════════════════════════

function convertNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    // 不要な要素をスキップ
    if (['button', 'svg', 'style', 'script', 'nav'].includes(tag)) return '';

    // ── 手順1: コードブロック (<pre>) ── 中身は一切変更しない
    if (tag === 'pre') {
        return handlePre(node);
    }

    // ── 手順2: <br> → ␠␠\n（即座に挿入、空行は作らない）
    if (tag === 'br') {
        return '  \n';
    }

    // ── 見出し ──
    if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = inlineContent(node);
        return '\n' + '#'.repeat(level) + ' ' + text + '\n\n';
    }

    // ── 手順3: <p> → 内容 + \n\n（段落の終了）
    if (tag === 'p') {
        const text = inlineContent(node);
        return text + '\n\n';
    }

    // ── 箇条書きリスト ──
    if (tag === 'ul') {
        return '\n' + handleList(node, 'ul', 0) + '\n\n';
    }

    // ── 番号付きリスト ──
    if (tag === 'ol') {
        return '\n' + handleList(node, 'ol', 0) + '\n\n';
    }

    // ── インラインコード (pre の外) ──
    if (tag === 'code') {
        return '`' + node.textContent + '`';
    }

    // ── 太字 ──
    if (tag === 'strong' || tag === 'b') {
        return '**' + inlineContent(node) + '**';
    }

    // ── 斜体 ──
    if (tag === 'em' || tag === 'i') {
        return '*' + inlineContent(node) + '*';
    }

    // ── リンク ──
    if (tag === 'a') {
        return handleLink(node);
    }

    // ── テーブル ──
    if (tag === 'table') {
        return '\n' + handleTable(node) + '\n\n';
    }

    // ── 汎用コンテナ (div, span 等) ── 子を順に処理
    return convertChildren(node);
}

/** 子ノードを順に変換して結合 */
function convertChildren(parent) {
    let out = '';
    for (const child of parent.childNodes) {
        out += convertNode(child);
    }
    return out;
}

/**
 * インライン要素のテキスト抽出。
 * <br> は ␠␠\n に変換し、<p>等のブロック要素もインラインとして結合する。
 */
function inlineContent(node) {
    let out = '';

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            out += child.nodeValue;
            continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName.toLowerCase();
        if (['button', 'svg', 'style', 'script'].includes(tag)) continue;

        if (tag === 'br') {
            out += '  \n';
        } else if (tag === 'strong' || tag === 'b') {
            out += '**' + inlineContent(child) + '**';
        } else if (tag === 'em' || tag === 'i') {
            out += '*' + inlineContent(child) + '*';
        } else if (tag === 'code') {
            out += '`' + child.textContent + '`';
        } else if (tag === 'a') {
            out += handleLink(child);
        } else {
            // p, div, span 等の中身をそのまま結合
            out += inlineContent(child);
        }
    }

    return out;
}

// ─── コードブロック ─── 中身は1文字も変更禁止
// DOM段階でプレースホルダに退避し、全整形処理から完全に隔離する
// CodeMirror DOM (span+br) の場合は extractPlainText で改行を正確に復元する
function handlePre(preNode) {
    let raw;
    const codeEl = preNode.querySelector('code');
    if (codeEl) {
        const langMatch = (codeEl.className || '').match(/language-(\S+)/);
        const lang = langMatch ? langMatch[1] : '';
        // CodeMirror の .cm-content があればそこから走査、なければ code 要素全体
        const contentRoot = codeEl.querySelector('.cm-content') || codeEl;
        const content = extractPlainText(contentRoot);
        raw = '~~~~' + lang + '\n' + content + '\n~~~~';
    } else {
        const contentRoot = preNode.querySelector('.cm-content') || preNode;
        const content = extractPlainText(contentRoot);
        raw = '~~~~\n' + content + '\n~~~~';
    }
    const idx = _codeBlockStore.length;
    _codeBlockStore.push(raw);
    return '\n%%CODEBLOCK_' + idx + '%%\n\n';
}

// ─── リンク ───
// URLだけ / テキストがURLと同一 → URL そのまま
// [url]() は絶対に出さない
function handleLink(aNode) {
    const href = aNode.getAttribute('href') || '';
    const linkText = inlineContent(aNode).trim();

    if (!linkText || linkText === href) {
        return href;
    }
    return '[' + linkText + '](' + href + ')';
}

// ─── リスト（入れ子対応、スペース4つ × depth） ───
function handleList(listNode, type, depth) {
    const items = [];
    let index = 1;
    const indent = '    '.repeat(depth);

    for (const child of listNode.children) {
        if (child.tagName.toLowerCase() !== 'li') continue;

        const textParts = [];
        const nestedLists = [];

        for (const liChild of child.childNodes) {
            if (liChild.nodeType === Node.TEXT_NODE) {
                const t = liChild.nodeValue.trim();
                if (t) textParts.push(t);
            } else if (liChild.nodeType === Node.ELEMENT_NODE) {
                const liChildTag = liChild.tagName.toLowerCase();
                if (liChildTag === 'ul' || liChildTag === 'ol') {
                    nestedLists.push({ node: liChild, type: liChildTag });
                } else {
                    const t = inlineContent(liChild).replace(/\n/g, ' ').trim();
                    if (t) textParts.push(t);
                }
            }
        }

        const text = textParts.join(' ');
        const prefix = type === 'ol' ? `${index}. ` : '- ';
        items.push(indent + prefix + text);
        index++;

        for (const nested of nestedLists) {
            items.push(handleList(nested.node, nested.type, depth + 1));
        }
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
        const cellTexts = Array.from(cells).map(c => inlineContent(c).replace(/\n/g, ' ').trim());
        result.push('| ' + cellTexts.join(' | ') + ' |');

        if (rowIdx === 0) {
            result.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
        }
    });

    return result.join('\n');
}
