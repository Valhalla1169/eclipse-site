// Tiny element builder. Children that are strings become TEXT NODES, never
// markup, so campaign and player names (user-controlled) cannot inject HTML.
// Handlers are attached with addEventListener, never as inline attributes,
// which keeps a strict Content-Security-Policy possible.
function build(el, props, children) {
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function h(tag, props = {}, ...children) {
  return build(document.createElement(tag), props, children);
}

// Same as h() for SVG elements, which need their own namespace.
export function s(tag, props = {}, ...children) {
  return build(document.createElementNS("http://www.w3.org/2000/svg", tag), props, children);
}

// Parses markup that lives in this repo, such as the rules text on the Reference
// tab. Never pass it anything that came from a person or the database.
export function staticHtml(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content;
}
