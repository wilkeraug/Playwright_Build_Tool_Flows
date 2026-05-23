import { toExtractedElement } from './selectorBuilder.js';
const DEFAULT_CONFIG = {
    maxTextLength: 200,
    maxAncestorDepth: 3,
    // Never meaningful to extract as standalone elements
    skipTags: [
        'script', 'style', 'noscript', 'template', 'meta', 'link',
        'head', 'html', 'body', 'br', 'hr', 'wbr', 'col', 'colgroup',
        'slot', 'shadow',
    ],
};
// ─────────────────────────────────────────────────────────────────────────────
// Browser-side function (plain ES5-compatible string — no TS transforms)
// ─────────────────────────────────────────────────────────────────────────────
const BROWSER_FN = `(function smartExtract(cfg) {
  var results = [];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function attr(el, name) { return el.getAttribute(name) || null; }

  function formAction(el) {
    var action = attr(el, 'formaction');
    if (action) return action;
    if (el.form) {
      return el.form.getAttribute('action') || null;
    }
    return null;
  }

  function getText(el) {
    // Use innerText (layout-aware) for visible text, fall back to textContent
    var raw = (el.innerText !== undefined ? el.innerText : el.textContent) || '';
    return raw.trim().replace(/\\s+/g, ' ').slice(0, cfg.maxTextLength) || null;
  }

  function getOwnText(el) {
    // Text that lives directly inside this element, not in children
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) text += n.textContent;
    }
    return text.trim().replace(/\\s+/g, ' ').slice(0, cfg.maxTextLength) || null;
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEnabled(el) {
    return !el.disabled && !el.closest('[disabled]') && attr(el, 'aria-disabled') !== 'true';
  }

  function getBoundingBox(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }

  function getAncestorPath(el, depth) {
    var path = [];
    var current = el.parentElement;
    var remaining = depth || 3;
    while (current && remaining > 0) {
      var id = current.id ? '#' + current.id : '';
      var cls = '';
      if (current.className && typeof current.className === 'string') {
        cls = '.' + current.className.trim().split(/\\s+/).slice(0, 2).join('.');
      }
      path.unshift(current.tagName.toLowerCase() + (id || cls));
      current = current.parentElement;
      remaining--;
    }
    return path;
  }

  function getNthIndex(el) {
    // 1-based index among siblings of same tag (for CSS nth-of-type)
    var tag = el.tagName;
    var siblings = el.parentElement ? el.parentElement.children : [];
    var idx = 1;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i] === el) return idx;
      if (siblings[i].tagName === tag) idx++;
    }
    return 1;
  }

  // ── ARIA role resolution ──────────────────────────────────────────────────

  var IMPLICIT_ROLES = {
    a: 'link', button: 'button', input: '_input', textarea: 'textbox',
    select: 'combobox', img: 'img', svg: 'img', canvas: 'img',
    video: 'video', audio: 'audio', details: 'group', summary: 'button',
    dialog: 'dialog', nav: 'navigation', main: 'main', header: 'banner',
    footer: 'contentinfo', aside: 'complementary', section: 'region',
    article: 'article', form: 'form', search: 'search',
    h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading',
    table: 'table', thead: 'rowgroup', tbody: 'rowgroup', tfoot: 'rowgroup',
    tr: 'row', td: 'cell', th: 'columnheader',
    ul: 'list', ol: 'list', li: 'listitem', dl: 'list', dt: 'term', dd: 'definition',
    menu: 'list', menuitem: 'menuitem',
    meter: 'meter', progress: 'progressbar',
    output: 'status', time: 'time',
    abbr: 'none', address: 'group', blockquote: 'blockquote',
    caption: 'caption', figure: 'figure', figcaption: 'none',
    p: 'paragraph', pre: 'none', code: 'none', mark: 'mark',
    del: 'deletion', ins: 'insertion',
    fieldset: 'group', legend: 'none',
    label: 'none', span: 'none', div: 'none',
    iframe: 'none', object: 'none',
    track: 'none', source: 'none',
    optgroup: 'group', option: 'option',
  };

  function resolveRole(el) {
    var explicit = attr(el, 'role');
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      var t = (attr(el, 'type') || 'text').toLowerCase();
      var inputRoles = {
        button: 'button', submit: 'button', reset: 'button', image: 'button',
        checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
        search: 'searchbox', tel: 'textbox', url: 'textbox', email: 'textbox',
        password: 'textbox', text: 'textbox', date: 'textbox', time: 'textbox',
        'datetime-local': 'textbox', month: 'textbox', week: 'textbox',
        color: 'none', file: 'none', hidden: 'none',
      };
      return inputRoles[t] || 'textbox';
    }
    if (tag === 'a') {
      return attr(el, 'href') ? 'link' : 'generic';
    }
    return IMPLICIT_ROLES[tag] || 'generic';
  }

  // ── Category classification ───────────────────────────────────────────────

  var INTERACTIVE_ROLES = {
    button: 1, link: 1, checkbox: 1, radio: 1, textbox: 1, combobox: 1,
    slider: 1, spinbutton: 1, searchbox: 1, switch: 1, tab: 1,
    menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, option: 1,
    treeitem: 1, gridcell: 1,
  };

  var LANDMARK_ROLES = {
    banner: 1, contentinfo: 1, complementary: 1, main: 1,
    navigation: 1, region: 1, search: 1, form: 1,
  };

  function classify(el, role, tag) {
    // Interactive elements
    if (role === 'button') return 'button';
    if (role === 'link') return 'link';
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton' || role === 'slider') return 'input';
    if (role === 'checkbox' || role === 'radio' || role === 'switch') return 'input';

    // Headings
    if (role === 'heading') return 'heading';

    // Dialogs / modals — distinct from page-level landmarks
    if (role === 'dialog' || role === 'alertdialog') return 'dialog';

    // Landmarks / structural
    if (LANDMARK_ROLES[role]) return 'landmark';

    // Images and media
    if (role === 'img') return 'image';
    if (role === 'video' || role === 'audio') return 'media';

    // Tables
    if (role === 'table' || role === 'grid' || role === 'treegrid') return 'table';
    if (role === 'row' || role === 'cell' || role === 'columnheader' || role === 'rowheader') return 'table';

    // Lists
    if (role === 'list' || role === 'listitem' || role === 'term' || role === 'definition') return 'list';
    if (role === 'menubar' || role === 'menu' || role === 'tree' || role === 'tablist') return 'list';

    // Forms
    if (tag === 'form' || role === 'form') return 'form';
    if (tag === 'fieldset' || tag === 'legend') return 'form';
    if (tag === 'label') return 'form';

    // Custom interactive — tabindex, onclick, contenteditable, draggable
    var tabIndex = attr(el, 'tabindex');
    var hasTabIndex = tabIndex !== null && parseInt(tabIndex, 10) >= 0;
    var hasOnclick = typeof el.onclick === 'function' || attr(el, 'onclick') !== null;
    var isContentEditable = attr(el, 'contenteditable') === 'true' || attr(el, 'contenteditable') === '';
    var isDraggable = attr(el, 'draggable') === 'true';
    if (hasTabIndex || hasOnclick || isContentEditable || isDraggable) return 'interactive';

    // Elements with data-testid / aria-label that haven't been caught above
    if (attr(el, 'data-testid')) return 'labelled';
    if (attr(el, 'aria-label') || attr(el, 'aria-labelledby') || attr(el, 'aria-describedby')) return 'labelled';

    // Inline text containers with meaningful own-text
    if (role === 'paragraph' || role === 'blockquote' || role === 'mark' ||
        role === 'deletion' || role === 'insertion' || role === 'time') return 'text';

    // Progress / status / meter
    if (role === 'progressbar' || role === 'meter' || role === 'status' || role === 'alert' || role === 'log' || role === 'timer') return 'widget';

    // Anything with a non-presentation explicit role we haven't covered
    if (INTERACTIVE_ROLES[role]) return 'interactive';

    // Generic containers with text might still be worth capturing
    var ownTxt = getOwnText(el);
    if (ownTxt && (tag === 'span' || tag === 'div' || tag === 'p' || tag === 'li' || tag === 'td' || tag === 'th' ||
                   tag === 'dt' || tag === 'dd' || tag === 'figcaption' || tag === 'blockquote' ||
                   tag === 'caption' || tag === 'legend' || tag === 'output')) {
      return 'text';
    }

    return null; // skip — pure layout container
  }

  // ── Skip-tag set ──────────────────────────────────────────────────────────
  var skipSet = {};
  for (var s = 0; s < cfg.skipTags.length; s++) skipSet[cfg.skipTags[s]] = true;

  // ── DOM walk ─────────────────────────────────────────────────────────────
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = el.tagName.toLowerCase();

    if (skipSet[tag]) continue;
    // Skip hidden inputs — no UI relevance
    if (tag === 'input' && attr(el, 'type') === 'hidden') continue;
    // Skip elements inside <template> (not rendered)
    if (el.closest('template')) continue;
    // Skip elements hidden from the accessibility tree — locators targeting
    // these will silently fail in Playwright's role/label queries
    if (el.closest('[aria-hidden="true"]')) continue;
    // Skip <option> and <optgroup> — captured implicitly via their parent <select>
    if (tag === 'option' || tag === 'optgroup') continue;

    var role = resolveRole(el);

    // Skip presentation-only roles
    if (role === 'none' || role === 'presentation' || role === 'generic') {
      // Still capture if it carries data-testid or aria-label
      if (!attr(el, 'data-testid') && !attr(el, 'aria-label') && !attr(el, 'aria-labelledby')) {
        // Or if it's a container with direct own text
        var ownTxtCheck = getOwnText(el);
        if (!ownTxtCheck) continue;
        // Fall through to classify as text
      }
    }

    // Promote testid-bearing elements whose name signals modal/dialog
    var testid = attr(el, 'data-testid') || '';
    if (/modal|dialog|drawer|overlay/i.test(testid)) {
      results.push({
        category: 'dialog',
        tag: tag,
        role: role,
        text: getText(el),
        ownText: getOwnText(el),
        id: attr(el, 'id'),
        name: attr(el, 'name'),
        placeholder: null,
        ariaLabel: attr(el, 'aria-label'),
        ariaLabelledBy: attr(el, 'aria-labelledby'),
        ariaDescribedBy: attr(el, 'aria-describedby'),
        ariaExpanded: attr(el, 'aria-expanded'),
        ariaSelected: attr(el, 'aria-selected'),
        ariaChecked: attr(el, 'aria-checked'),
        ariaHidden: attr(el, 'aria-hidden'),
        dataTestId: testid,
        type: null,
        href: null,
        src: null,
        alt: null,
        value: null,
        onclick: attr(el, 'onclick'),
        dataHref: attr(el, 'data-href'),
        dataUrl: attr(el, 'data-url'),
        dataAction: attr(el, 'data-action'),
        formAction: formAction(el),
        ariaControls: attr(el, 'aria-controls'),
        ariaHasPopup: attr(el, 'aria-haspopup'),
        clickHint: null,
        headingLevel: null,
        nthIndex: getNthIndex(el),
        isVisible: isVisible(el),
        isEnabled: isEnabled(el),
        boundingBox: getBoundingBox(el),
        ancestorPath: getAncestorPath(el, cfg.maxAncestorDepth),
      });
      continue;
    }

    var category = classify(el, role, tag);
    if (!category) continue;

    var text = getText(el);
    // For text category: require non-empty text
    if ((category === 'text') && !text) continue;
    // For image: use alt text as text
    var altText = attr(el, 'alt');
    if (category === 'image' && !text) text = altText;

    var headingLevel = null;
    if (/^h[1-6]$/.test(tag)) {
      headingLevel = parseInt(tag[1], 10);
    } else if (attr(el, 'aria-level')) {
      var lvl = parseInt(attr(el, 'aria-level'), 10);
      if (!isNaN(lvl)) headingLevel = lvl;
    }

    results.push({
      category: category,
      tag: tag,
      role: role,
      text: text,
      ownText: getOwnText(el),
      id: attr(el, 'id'),
      name: attr(el, 'name'),
      placeholder: attr(el, 'placeholder'),
      ariaLabel: attr(el, 'aria-label'),
      ariaLabelledBy: attr(el, 'aria-labelledby'),
      ariaDescribedBy: attr(el, 'aria-describedby'),
      ariaExpanded: attr(el, 'aria-expanded'),
      ariaSelected: attr(el, 'aria-selected'),
      ariaChecked: attr(el, 'aria-checked'),
      ariaHidden: attr(el, 'aria-hidden'),
      dataTestId: attr(el, 'data-testid'),
      type: attr(el, 'type'),
      href: attr(el, 'href'),
      src: attr(el, 'src'),
      alt: altText,
      value: attr(el, 'value'),
      onclick: attr(el, 'onclick'),
      dataHref: attr(el, 'data-href'),
      dataUrl: attr(el, 'data-url'),
      dataAction: attr(el, 'data-action'),
      formAction: formAction(el),
      ariaControls: attr(el, 'aria-controls'),
      ariaHasPopup: attr(el, 'aria-haspopup'),
      clickHint: null,
      headingLevel: headingLevel,
      nthIndex: getNthIndex(el),
      isVisible: isVisible(el),
      isEnabled: isEnabled(el),
      boundingBox: getBoundingBox(el),
      ancestorPath: getAncestorPath(el, cfg.maxAncestorDepth),
    });
  }

  // ── Shadow DOM walk ───────────────────────────────────────────────────────
  // Playwright's querySelectorAll does not pierce shadow roots. We walk every
  // element that has a shadowRoot and extract from it directly.
  function walkShadow(root) {
    var shadowEls = root.querySelectorAll('*');
    for (var si = 0; si < shadowEls.length; si++) {
      var sel = shadowEls[si];
      var stag = sel.tagName.toLowerCase();
      if (skipSet[stag]) continue;
      if (stag === 'input' && sel.getAttribute('type') === 'hidden') continue;
      if (sel.closest && sel.closest('[aria-hidden="true"]')) continue;

      var srole = resolveRole(sel);
      if (srole === 'none' || srole === 'presentation' || srole === 'generic') {
        if (!sel.getAttribute('data-testid') && !sel.getAttribute('aria-label') && !sel.getAttribute('aria-labelledby')) {
          if (!getOwnText(sel)) continue;
        }
      }

      var scat = classify(sel, srole, stag);
      if (!scat) continue;

      var stext = getText(sel);
      if (scat === 'text' && !stext) continue;
      var salt = sel.getAttribute('alt');
      if (scat === 'image' && !stext) stext = salt;

      var shl = null;
      if (/^h[1-6]$/.test(stag)) {
        shl = parseInt(stag[1], 10);
      } else if (sel.getAttribute('aria-level')) {
        var slvl = parseInt(sel.getAttribute('aria-level'), 10);
        if (!isNaN(slvl)) shl = slvl;
      }

      results.push({
        category: scat,
        tag: stag,
        role: srole,
        text: stext,
        ownText: getOwnText(sel),
        id: sel.getAttribute('id'),
        name: sel.getAttribute('name'),
        placeholder: sel.getAttribute('placeholder'),
        ariaLabel: sel.getAttribute('aria-label'),
        ariaLabelledBy: sel.getAttribute('aria-labelledby'),
        ariaDescribedBy: sel.getAttribute('aria-describedby'),
        ariaExpanded: sel.getAttribute('aria-expanded'),
        ariaSelected: sel.getAttribute('aria-selected'),
        ariaChecked: sel.getAttribute('aria-checked'),
        ariaHidden: sel.getAttribute('aria-hidden'),
        dataTestId: sel.getAttribute('data-testid'),
        type: sel.getAttribute('type'),
        href: sel.getAttribute('href'),
        src: sel.getAttribute('src'),
        alt: salt,
        value: sel.getAttribute('value'),
        onclick: sel.getAttribute('onclick'),
        dataHref: sel.getAttribute('data-href'),
        dataUrl: sel.getAttribute('data-url'),
        dataAction: sel.getAttribute('data-action'),
        formAction: formAction(sel),
        ariaControls: sel.getAttribute('aria-controls'),
        ariaHasPopup: sel.getAttribute('aria-haspopup'),
        clickHint: null,
        headingLevel: shl,
        nthIndex: getNthIndex(sel),
        isVisible: isVisible(sel),
        isEnabled: isEnabled(sel),
        boundingBox: getBoundingBox(sel),
        ancestorPath: getAncestorPath(sel, cfg.maxAncestorDepth),
      });

      if (sel.shadowRoot) walkShadow(sel.shadowRoot);
    }
  }

  var allForShadow = document.querySelectorAll('*');
  for (var wi = 0; wi < allForShadow.length; wi++) {
    if (allForShadow[wi].shadowRoot) walkShadow(allForShadow[wi].shadowRoot);
  }

  // ── iframe content walk ───────────────────────────────────────────────────
  // Same extraction logic, but scoped to each same-origin iframe's document.
  // Cross-origin iframes are silently skipped (contentDocument will be null).
  var iframes = document.querySelectorAll('iframe');
  for (var fi = 0; fi < iframes.length; fi++) {
    var frame = iframes[fi];
    var fdoc;
    try { fdoc = frame.contentDocument; } catch(e) { fdoc = null; }
    if (!fdoc) continue;

    var frameAll = fdoc.querySelectorAll('*');
    for (var fj = 0; fj < frameAll.length; fj++) {
      var fel = frameAll[fj];
      var ftag = fel.tagName.toLowerCase();
      if (skipSet[ftag]) continue;
      if (ftag === 'input' && fel.getAttribute('type') === 'hidden') continue;
      if (fel.closest && fel.closest('template')) continue;
      if (fel.closest && fel.closest('[aria-hidden="true"]')) continue;

      var frole = resolveRole(fel);
      if (frole === 'none' || frole === 'presentation' || frole === 'generic') {
        if (!fel.getAttribute('data-testid') && !fel.getAttribute('aria-label') && !fel.getAttribute('aria-labelledby')) {
          if (!getOwnText(fel)) continue;
        }
      }

      var fcat = classify(fel, frole, ftag);
      if (!fcat) continue;

      var ftext = getText(fel);
      if (fcat === 'text' && !ftext) continue;
      var falt = fel.getAttribute('alt');
      if (fcat === 'image' && !ftext) ftext = falt;

      var fhl = null;
      if (/^h[1-6]$/.test(ftag)) {
        fhl = parseInt(ftag[1], 10);
      } else if (fel.getAttribute('aria-level')) {
        var flvl = parseInt(fel.getAttribute('aria-level'), 10);
        if (!isNaN(flvl)) fhl = flvl;
      }

      results.push({
        category: fcat,
        tag: ftag,
        role: frole,
        text: ftext,
        ownText: getOwnText(fel),
        id: fel.getAttribute('id'),
        name: fel.getAttribute('name'),
        placeholder: fel.getAttribute('placeholder'),
        ariaLabel: fel.getAttribute('aria-label'),
        ariaLabelledBy: fel.getAttribute('aria-labelledby'),
        ariaDescribedBy: fel.getAttribute('aria-describedby'),
        ariaExpanded: fel.getAttribute('aria-expanded'),
        ariaSelected: fel.getAttribute('aria-selected'),
        ariaChecked: fel.getAttribute('aria-checked'),
        ariaHidden: fel.getAttribute('aria-hidden'),
        dataTestId: fel.getAttribute('data-testid'),
        type: fel.getAttribute('type'),
        href: fel.getAttribute('href'),
        src: fel.getAttribute('src'),
        alt: falt,
        value: fel.getAttribute('value'),
        onclick: fel.getAttribute('onclick'),
        dataHref: fel.getAttribute('data-href'),
        dataUrl: fel.getAttribute('data-url'),
        dataAction: fel.getAttribute('data-action'),
        formAction: formAction(fel),
        ariaControls: fel.getAttribute('aria-controls'),
        ariaHasPopup: fel.getAttribute('aria-haspopup'),
        clickHint: null,
        headingLevel: fhl,
        nthIndex: getNthIndex(fel),
        isVisible: isVisible(fel),
        isEnabled: isEnabled(fel),
        boundingBox: getBoundingBox(fel),
        ancestorPath: getAncestorPath(fel, cfg.maxAncestorDepth),
      });
    }
  }

  return results;
})`;
export async function extractElements(page) {
    const rawResults = await page.evaluate(
    // eslint-disable-next-line no-new-func
    new Function(`return (${BROWSER_FN})(arguments[0])`), DEFAULT_CONFIG);
    return rawResults.map(toExtractedElement);
}
