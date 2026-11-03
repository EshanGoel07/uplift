// Renders GitHub issue Markdown (untrusted) to sanitised HTML: no images, no scripts, no iframes,
// no inline handlers, links only to http(s)/mailto and always opened with noopener noreferrer.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, breaks: true, async: false });

let hooked = false;
function ensureHooks(purify: typeof DOMPurify) {
  if (hooked) return;
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  hooked = true;
}

export function renderIssueMarkdown(src: string, purify: typeof DOMPurify = DOMPurify): string {
  ensureHooks(purify);
  const html = marked.parse(src.replace(/\r\n/g, '\n')) as string;
  return purify.sanitize(html, {
    FORBID_TAGS: ['img', 'picture', 'source', 'video', 'audio', 'iframe', 'object', 'embed', 'svg', 'math', 'style', 'form', 'input', 'button', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset', 'src', 'background', 'poster'],
    ALLOW_DATA_ATTR: false,
  });
}
