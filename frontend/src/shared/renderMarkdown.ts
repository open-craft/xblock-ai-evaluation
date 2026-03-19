interface MarkedRenderer {
  parse(markdown: string): string;
}

interface MarkedWindow extends Window {
  marked?: MarkedRenderer;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripScriptTags(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const scripts = container.getElementsByTagName("script");
  while (scripts.length > 0) {
    scripts[0].parentNode?.removeChild(scripts[0]);
  }

  return container.innerHTML;
}

function getMarkedIframe() {
  return (
    document.getElementById("ai-eval-react-marked-iframe") ||
    document.getElementById("marked-iframe")
  ) as HTMLIFrameElement | null;
}

function getMarkedRenderer() {
  const iframe = getMarkedIframe();
  const markedWindow = window as MarkedWindow;

  if (markedWindow.marked) {
    return markedWindow.marked;
  }

  if (iframe?.contentWindow) {
    const iframeWindow = iframe.contentWindow as MarkedWindow;
    if (iframeWindow.marked) {
      markedWindow.marked = iframeWindow.marked;
      return markedWindow.marked;
    }
  }

  return null;
}

export function ensureMarkdownRenderer(markedHtml?: string) {
  let iframe = getMarkedIframe();
  const renderer = getMarkedRenderer();

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

  return new Promise<MarkedRenderer | null>((resolve) => {
    iframe?.addEventListener(
      "load",
      function handleLoad() {
        resolve(getMarkedRenderer());
      },
      { once: true },
    );
  });
}

export function renderMarkdown(markdown?: string) {
  const renderer = getMarkedRenderer();
  const content = markdown || "";

  if (!renderer?.parse) {
    return escapeHtml(content).replace(/\n/g, "<br />");
  }

  return stripScriptTags(renderer.parse(content));
}
