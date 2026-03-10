function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripScriptTags(html) {
  var container = document.createElement("div");
  var scripts;

  container.innerHTML = html;
  scripts = container.getElementsByTagName("script");
  while (scripts.length > 0) {
    scripts[0].parentNode.removeChild(scripts[0]);
  }

  return container.innerHTML;
}

function getMarkedIframe() {
  return (
    document.getElementById("ai-eval-react-marked-iframe") ||
    document.getElementById("marked-iframe")
  );
}

function getMarkedRenderer() {
  var iframe = getMarkedIframe();

  if (window.marked) {
    return window.marked;
  }

  if (iframe && iframe.contentWindow && iframe.contentWindow.marked) {
    window.marked = iframe.contentWindow.marked;
    return window.marked;
  }

  return null;
}

export function ensureMarkdownRenderer(markedHtml) {
  var iframe = getMarkedIframe();
  var renderer = getMarkedRenderer();

  if (renderer || !markedHtml) {
    return Promise.resolve(renderer);
  }

  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "ai-eval-react-marked-iframe";
    iframe.style.display = "none";
    iframe.srcdoc = markedHtml;
    document.body.appendChild(iframe);
  }

  return new Promise(function waitForMarked(resolve) {
    iframe.addEventListener("load", function handleLoad() {
      resolve(getMarkedRenderer());
    }, { once: true });
  });
}

export function renderMarkdown(markdown) {
  var renderer = getMarkedRenderer();
  var content = markdown || "";

  if (!renderer || !renderer.parse) {
    return escapeHtml(content).replace(/\n/g, "<br />");
  }

  return stripScriptTags(renderer.parse(content));
}
