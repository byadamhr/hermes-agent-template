/**
 * Hermes Media — Dashboard Plugin (v2)
 *
 * Browse, preview, upload, and manage files/folders in /data/media.
 * Features: folder navigation, multi-select, drag-and-drop, batch ops.
 * Plain IIFE, no build step. Uses window.__HERMES_PLUGIN_SDK__.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  var React = SDK.React;
  var h = React.createElement;
  var Button = SDK.components.Button;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useCallback = SDK.hooks.useCallback;
  var useRef = SDK.hooks.useRef;
  var useMemo = SDK.hooks.useMemo;

  // -------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------

  var API = "/api/plugins/media";

  var SKIP_TEXT_PREVIEW = {
    pdf: true, doc: true, docx: true, xls: true, xlsx: true,
    zip: true, gz: true, tar: true, rar: true, "7z": true,
    exe: true, dmg: true, so: true, dll: true, bin: true,
    jpg: true, jpeg: true, png: true, gif: true, webp: true,
    svg: true, bmp: true, ico: true, tiff: true, avif: true,
    mp4: true, webm: true, mkv: true, avi: true, mov: true,
    mp3: true, wav: true, ogg: true, flac: true, aac: true,
  };

  // -------------------------------------------------------------------
  // Auth-aware fetch helpers
  // -------------------------------------------------------------------

  function authHeaders(extra) {
    var token = window.__HERMES_SESSION_TOKEN__ || "";
    var hdrs = {};
    hdrs["X-Hermes-Session-Token"] = token;
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        hdrs[keys[i]] = extra[keys[i]];
      }
    }
    return hdrs;
  }

  function fetchBlobUrl(url) {
    return fetch(url, { headers: authHeaders() })
      .then(function (res) {
        if (!res.ok) throw new Error("Fetch failed (" + res.status + ")");
        return res.blob();
      })
      .then(function (blob) {
        return URL.createObjectURL(blob);
      });
  }

  function authFetch(url, opts) {
    opts = opts || {};
    var callerHeaders = opts.headers || {};
    opts.headers = authHeaders(callerHeaders);
    return fetch(url, opts);
  }

  // -------------------------------------------------------------------
  // Formatters
  // -------------------------------------------------------------------

  function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    var val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
    return val + " " + units[i];
  }

  function formatTime(ts) {
    if (typeof SDK.utils.timeAgo === "function") {
      return SDK.utils.timeAgo(ts * 1000);
    }
    try {
      return new Date(ts * 1000).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      });
    } catch (e) { return ""; }
  }

  function extLabel(file) {
    if (file.is_image) return { icon: "\uD83D\uDDBC\uFE0F", label: "Image", color: "#818cf8" };
    if (file.is_video) return { icon: "\uD83C\uDFAC", label: "Video", color: "#f472b6" };
    if (file.is_audio) return { icon: "\uD83C\uDFB5", label: "Audio", color: "#34d399" };
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    var map = {
      pdf: ["\uD83D\uDCD5", "PDF", "#ef4444"],
      doc: ["\uD83D\uDCDD", "DOC", "#60a5fa"], docx: ["\uD83D\uDCDD", "DOC", "#60a5fa"],
      txt: ["\uD83D\uDCC4", "TEXT", "#9ca3af"],
      zip: ["\uD83D\uDCE6", "ZIP", "#fbbf24"], gz: ["\uD83D\uDCE6", "GZIP", "#fbbf24"],
      tar: ["\uD83D\uDCE6", "TAR", "#fbbf24"],
      json: ["{ }", "JSON", "#fbbf24"],
      csv: ["\uD83D\uDCCA", "CSV", "#34d399"],
      md: ["\uD83D\uDCD1", "MD", "#a78bfa"],
      py: ["\uD83D\uDC0D", "PY", "#60a5fa"],
      js: ["\uD83D\uDCDC", "JS", "#fbbf24"],
      ts: ["\uD83D\uDCDC", "TS", "#3b82f6"],
      html: ["\uD83C\uDF10", "HTML", "#f97316"],
      css: ["\uD83C\uDFA8", "CSS", "#818cf8"],
    };
    var entry = map[ext];
    return entry
      ? { icon: entry[0], label: entry[1], color: entry[2] }
      : { icon: "\uD83D\uDCC4", label: ext.toUpperCase() || "FILE", color: "#9ca3af" };
  }

  function getExt(file) {
    return (file.name.split(".").pop() || "").toLowerCase();
  }

  // -------------------------------------------------------------------
  // Confirm dialog
  // -------------------------------------------------------------------

  function ConfirmDialog(props) {
    return h("div", { className: "hermes-media-confirm-overlay", onClick: props.onCancel },
      h("div", { className: "hermes-media-confirm-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, props.title || "Confirm"),
        h("p", null, props.message),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { className: "cancel", onClick: props.onCancel }, "Cancel"),
          h("button", { className: "confirm", onClick: props.onConfirm }, props.confirmLabel || "Delete"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Rename dialog
  // -------------------------------------------------------------------

  function RenameDialog(props) {
    var _s = useState(props.currentName);
    var newName = _s[0];
    var setNewName = _s[1];
    var _e = useState(null);
    var err = _e[0];
    var setErr = _e[1];
    var _busy = useState(false);
    var busy = _busy[0];
    var setBusy = _busy[1];
    var inputRef = useRef(null);

    useEffect(function () {
      if (inputRef.current) {
        inputRef.current.focus();
        var dot = props.currentName.lastIndexOf(".");
        inputRef.current.setSelectionRange(0, dot > 0 ? dot : props.currentName.length);
      }
    }, []);

    function handleSubmit(e) {
      e.preventDefault();
      var trimmed = newName.trim();
      if (!trimmed || trimmed === props.currentName) {
        props.onClose();
        return;
      }
      setBusy(true);
      setErr(null);
      SDK.fetchJSON(API + "/file/" + encodeURIComponent(props.path), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }).then(function (data) {
        setBusy(false);
        if (data.error) { setErr(data.error); return; }
        props.onRenamed(data.path, data.name);
      }).catch(function (err) {
        setBusy(false);
        setErr(err.message || "Rename failed");
      });
    }

    return h("div", { className: "hermes-media-confirm-overlay", onClick: props.onClose },
      h("div", { className: "hermes-media-confirm-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, props.title || "Rename"),
        h("form", { onSubmit: handleSubmit, style: { margin: "0.75rem 0" } },
          h("input", {
            ref: inputRef, type: "text", value: newName,
            onChange: function (e) { setNewName(e.target.value); },
            className: "hermes-rename-input", disabled: busy,
          }),
          err && h("div", { className: "hermes-rename-error" }, err),
        ),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { type: "button", className: "cancel", onClick: props.onClose, disabled: busy }, "Cancel"),
          h("button", { type: "submit", className: "confirm", onClick: handleSubmit, disabled: busy,
            style: { background: "#2563eb", borderColor: "#1d4ed8" } },
            busy ? "Renaming\u2026" : "Rename"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Create folder dialog
  // -------------------------------------------------------------------

  function CreateFolderDialog(props) {
    var _s = useState("");
    var name = _s[0];
    var setName = _s[1];
    var _e = useState(null);
    var err = _e[0];
    var setErr = _e[1];
    var _busy = useState(false);
    var busy = _busy[0];
    var setBusy = _busy[1];
    var inputRef = useRef(null);

    useEffect(function () {
      if (inputRef.current) inputRef.current.focus();
    }, []);

    function handleSubmit(e) {
      e.preventDefault();
      var trimmed = name.trim();
      if (!trimmed) return;
      setBusy(true);
      setErr(null);
      SDK.fetchJSON(API + "/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parent: props.parentPath || "" }),
      }).then(function (data) {
        setBusy(false);
        if (data.error) { setErr(data.error); return; }
        props.onCreated(data);
      }).catch(function (err) {
        setBusy(false);
        setErr(err.message || "Failed to create folder");
      });
    }

    return h("div", { className: "hermes-media-confirm-overlay", onClick: props.onClose },
      h("div", { className: "hermes-media-confirm-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, "New Folder"),
        h("form", { onSubmit: handleSubmit, style: { margin: "0.75rem 0" } },
          h("input", {
            ref: inputRef, type: "text", value: name, placeholder: "Folder name",
            onChange: function (e) { setName(e.target.value); },
            className: "hermes-rename-input", disabled: busy,
          }),
          err && h("div", { className: "hermes-rename-error" }, err),
        ),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { type: "button", className: "cancel", onClick: props.onClose, disabled: busy }, "Cancel"),
          h("button", { type: "submit", className: "confirm", onClick: handleSubmit, disabled: busy,
            style: { background: "#2563eb", borderColor: "#1d4ed8" } },
            busy ? "Creating\u2026" : "Create"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Breadcrumbs
  // -------------------------------------------------------------------

  function Breadcrumbs(props) {
    var currentPath = props.currentPath;
    var onNavigate = props.onNavigate;

    var parts = currentPath ? currentPath.split("/").filter(Boolean) : [];

    var items = [];
    items.push(
      h("span", {
        key: "root",
        className: "hermes-breadcrumb-item" + (parts.length === 0 ? " active" : ""),
        onClick: function () { onNavigate(""); },
      }, "\uD83C\uDFE0 Media")
    );

    var accumulated = "";
    for (var i = 0; i < parts.length; i++) {
      accumulated += (i > 0 ? "/" : "") + parts[i];
      var isLast = i === parts.length - 1;
      items.push(
        h("span", { key: "sep-" + i, className: "hermes-breadcrumb-sep" }, " \u203A "),
        h("span", {
          key: accumulated,
          className: "hermes-breadcrumb-item" + (isLast ? " active" : ""),
          onClick: isLast ? undefined : function (p) { return function () { onNavigate(p); }; }(accumulated),
        }, parts[i])
      );
    }

    return h("div", { className: "hermes-breadcrumbs" }, items);
  }

  // -------------------------------------------------------------------
  // Auth-aware image preview
  // -------------------------------------------------------------------

  function FilePreview(props) {
    var file = props.file;
    var onClick = props.onClick;
    var _s = useState(null);
    var blobUrl = _s[0];
    var setBlobUrl = _s[1];
    var urlRef = useRef(null);

    useEffect(function () {
      var fileUrl = API + "/file/" + encodeURIComponent(file.path);
      fetchBlobUrl(fileUrl).then(function (u) {
        urlRef.current = u;
        setBlobUrl(u);
      }).catch(function () { });
      return function () {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
      };
    }, [file.path]);

    if (file.is_image) {
      if (blobUrl) {
        return h("div", { className: "hermes-media-preview clickable", onClick: onClick },
          h("img", { src: blobUrl, alt: file.name, loading: "lazy" }),
        );
      }
      return h("div", { className: "hermes-media-preview" },
        h("div", { className: "hermes-media-preview-icon" },
          h("div", { className: "hermes-media-spinner" }),
          h("span", null, "Loading\u2026"),
        ),
      );
    }

    if (file.is_video) {
      if (blobUrl) {
        return h("div", { className: "hermes-media-preview clickable", onClick: onClick,
          style: { position: "relative" } },
          h("video", { src: blobUrl, preload: "metadata", controls: false },
            h("track", { kind: "captions" }),
          ),
          h("div", { className: "hermes-media-play-overlay"}, "\u25B6"),
        );
      }
      return h("div", { className: "hermes-media-preview" },
        h("div", { className: "hermes-media-preview-icon" },
          h("div", { className: "hermes-media-spinner" }),
          h("span", null, "Loading\u2026"),
        ),
      );
    }

    if (file.is_audio) {
      return h("div", { className: "hermes-media-preview audio-preview", onClick: onClick },
        h("div", { className: "hermes-media-preview-icon" },
          h("span", { style: { fontSize: "2.5rem" } }, "\uD83C\uDFB5"),
          h("span", null, "Audio"),
        ),
      );
    }

    var ft = extLabel(file);
    return h("div", { className: "hermes-media-preview clickable", onClick: onClick,
      style: { background: "color-mix(in srgb, " + ft.color + " 8%, var(--color-muted, #111827))" } },
      h("div", { className: "hermes-media-preview-icon" },
        h("span", { style: { fontSize: "2.5rem", color: ft.color } }, ft.icon),
        h("span", { style: { color: ft.color } }, ft.label),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Folder card
  // -------------------------------------------------------------------

  function FolderCard(props) {
    var folder = props.folder;
    var onOpen = props.onOpen;
    var onDelete = props.onDelete;
    var onRename = props.onRename;
    var onDropFile = props.onDropFile;
    var selected = props.selected;
    var onSelect = props.onSelect;
    var _showRename = useState(false);
    var showRename = _showRename[0];
    var setShowRename = _showRename[1];
    var _showConfirm = useState(false);
    var showConfirm = _showConfirm[0];
    var setShowConfirm = _showConfirm[1];
    var _dragOver = useState(false);
    var dragOver = _dragOver[0];
    var setDragOver = _dragOver[1];

    function handleDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }
    function handleDragLeave(e) {
      e.preventDefault();
      setDragOver(false);
    }
    function handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      var filePath = e.dataTransfer.getData("text/file-path");
      if (filePath && onDropFile) {
        onDropFile(filePath, folder.path);
      }
    }

    var totalItems = (folder.file_count || 0) + (folder.folder_count || 0);

    return h("div", {
      className: "hermes-media-folder-card" + (dragOver ? " drag-over" : "") + (selected ? " selected" : ""),
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
      // Select checkbox
      h("div", { className: "hermes-media-folder-checkbox", onClick: function (e) { e.stopPropagation(); onSelect(folder); } },
        h("div", { className: "hermes-checkbox" + (selected ? " checked" : "") },
          selected && "\u2713"
        ),
      ),
      // Delete button
      h("button", {
        className: "hermes-media-card-delete",
        onClick: function (e) { e.stopPropagation(); setShowConfirm(true); },
        title: "Delete folder",
      }, "\u2715"),
      // Folder icon + info
      h("div", { className: "hermes-media-folder-body", onClick: function () { onOpen(folder.path); } },
        h("div", { className: "hermes-media-folder-icon" }, "\uD83D\uDCC1"),
        h("p", { className: "hermes-media-filename", title: folder.name }, folder.name),
        h("div", { className: "hermes-media-meta" },
          h("span", null, totalItems + " item" + (totalItems !== 1 ? "s" : "")),
        ),
      ),
      // Actions
      h("div", { className: "hermes-media-actions" },
        h("button", { onClick: function (e) { e.stopPropagation(); onOpen(folder.path); } }, "\uD83D\uDCC2 Open"),
        h("button", { onClick: function (e) {
          e.stopPropagation();
          // Download all files in this folder
          authFetch(API + "/files?path=" + encodeURIComponent(folder.path))
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (!data.files || data.files.length === 0) return;
              var delay = 300;
              data.files.forEach(function (f, idx) {
                setTimeout(function () {
                  var url = API + "/file/" + encodeURIComponent(f.path);
                  authFetch(url).then(function (res) { return res.blob(); }).then(function (blob) {
                    var a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = f.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                  });
                }, idx * delay);
              });
            });
        } }, "\u2B07 Download"),
        h("button", { onClick: function (e) { e.stopPropagation(); setShowRename(true); } }, "\u270F Rename"),
      ),
      showConfirm && h(ConfirmDialog, {
        title: "Delete folder?",
        message: "Delete \"" + folder.name + "\" and all its contents?",
        confirmLabel: "Delete",
        onConfirm: function () { setShowConfirm(false); onDelete(folder.path); },
        onCancel: function () { setShowConfirm(false); },
      }),
      showRename && h(RenameDialog, {
        title: "Rename folder",
        currentName: folder.name,
        path: folder.path,
        onClose: function () { setShowRename(false); },
        onRenamed: function (newPath, newName) {
          setShowRename(false);
          onRename(folder.path, newPath, newName);
        },
      }),
    );
  }

  // -------------------------------------------------------------------
  // File card
  // -------------------------------------------------------------------

  function FileCard(props) {
    var file = props.file;
    var onDelete = props.onDelete;
    var onPreview = props.onPreview;
    var onRename = props.onRename;
    var selected = props.selected;
    var onSelect = props.onSelect;
    var _showConfirm = useState(false);
    var showConfirm = _showConfirm[0];
    var setShowConfirm = _showConfirm[1];
    var _showRename = useState(false);
    var showRename = _showRename[0];
    var setShowRename = _showRename[1];
    var ft = extLabel(file);

    function handleDragStart(e) {
      e.dataTransfer.setData("text/file-path", file.path);
      e.dataTransfer.effectAllowed = "move";
    }

    function handleDownload(e) {
      e.preventDefault();
      e.stopPropagation();
      var url = API + "/file/" + encodeURIComponent(file.path);
      authFetch(url).then(function (res) { return res.blob(); }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      });
    }

    return h("div", {
      className: "hermes-media-card" + (selected ? " selected" : ""),
      draggable: "true",
      onDragStart: handleDragStart,
    },
      // Select checkbox
      h("div", { className: "hermes-media-card-checkbox", onClick: function (e) { e.stopPropagation(); onSelect(file); } },
        h("div", { className: "hermes-checkbox" + (selected ? " checked" : "") },
          selected && "\u2713"
        ),
      ),
      // Floating delete button
      h("button", {
        className: "hermes-media-card-delete",
        onClick: function (e) { e.stopPropagation(); setShowConfirm(true); },
        title: "Delete",
      }, "\u2715"),
      h(FilePreview, { file: file, onClick: function () { onPreview(file); } }),
      h("div", { className: "hermes-media-info", onClick: function () { onPreview(file); } },
        h("p", { className: "hermes-media-filename", title: file.name }, file.name),
        h("div", { className: "hermes-media-meta" },
          h("span", { style: { color: ft.color } }, ft.icon),
          h("span", null, formatSize(file.size)),
          h("span", null, "\u00B7"),
          h("span", null, formatTime(file.mtime)),
        ),
      ),
      h("div", { className: "hermes-media-actions" },
        h("button", { onClick: handleDownload }, "\u2B07 Download"),
        h("button", { onClick: function (e) { e.stopPropagation(); setShowRename(true); } }, "\u270F Rename"),
      ),
      showConfirm && h(ConfirmDialog, {
        title: "Delete file?",
        message: "Are you sure you want to delete \"" + file.name + "\"?",
        confirmLabel: "Delete",
        onConfirm: function () { setShowConfirm(false); onDelete(file.path); },
        onCancel: function () { setShowConfirm(false); },
      }),
      showRename && h(RenameDialog, {
        currentName: file.name,
        path: file.path,
        onClose: function () { setShowRename(false); },
        onRenamed: function (newPath, newName) {
          setShowRename(false);
          onRename(file.path, newPath, newName);
        },
      }),
    );
  }

  // -------------------------------------------------------------------
  // Preview modal
  // -------------------------------------------------------------------

  function PreviewModal(props) {
    var file = props.file;
    var onClose = props.onClose;
    var _s1 = useState(null);
    var content = _s1[0];
    var setContent = _s1[1];
    var _s2 = useState(null);
    var blobUrl = _s2[0];
    var setBlobUrl = _s2[1];
    var _s3 = useState(false);
    var loadError = _s3[0];
    var setLoadError = _s3[1];
    var urlRef = useRef(null);

    var ext = getExt(file);
    var isHtml = ext === "html" || ext === "htm";
    var isPdf = ext === "pdf";

    useEffect(function () {
      var fileUrl = API + "/file/" + encodeURIComponent(file.path);
      if (file.is_image || file.is_video || file.is_audio || isPdf || isHtml) {
        fetchBlobUrl(fileUrl).then(function (u) {
          urlRef.current = u;
          setBlobUrl(u);
        }).catch(function () { setLoadError(true); });
      } else if (!SKIP_TEXT_PREVIEW[ext]) {
        SDK.fetchJSON(API + "/text/" + encodeURIComponent(file.path))
          .then(function (data) { setContent(data.content); })
          .catch(function () { setContent(null); setLoadError(true); });
      } else {
        setLoadError(true);
      }
      return function () {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
      };
    }, [file.path]);

    useEffect(function () {
      function onKey(e) { if (e.key === "Escape") onClose(); }
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }, [onClose]);

    var ft = extLabel(file);

    function handleDownload() {
      var url = API + "/file/" + encodeURIComponent(file.path);
      authFetch(url).then(function (res) { return res.blob(); }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      });
    }

    function renderContent() {
      if (file.is_image && blobUrl) return h("img", { src: blobUrl, alt: file.name, className: "hermes-preview-img" });
      if (file.is_video && blobUrl) return h("video", { src: blobUrl, controls: true, autoPlay: true, className: "hermes-preview-video" }, h("track", { kind: "captions" }));
      if (file.is_audio && blobUrl) return h("div", { className: "hermes-preview-audio-wrap" },
        h("div", { style: { fontSize: "4rem", marginBottom: "1rem" } }, "\uD83C\uDFB5"),
        h("audio", { src: blobUrl, controls: true, autoPlay: true, style: { width: "100%" } }),
      );
      if (isPdf && blobUrl) return h("iframe", { src: blobUrl, className: "hermes-preview-iframe", title: file.name });
      if (isHtml && blobUrl) return h("iframe", { src: blobUrl, className: "hermes-preview-iframe", title: file.name, sandbox: "allow-scripts allow-popups" });
      if (content !== null) return h("pre", { className: "hermes-preview-text" }, content);
      if (loadError) return h("div", { className: "hermes-preview-not-previewable" },
        h("div", { style: { fontSize: "3rem", marginBottom: "0.75rem" } }, ft.icon),
        h("p", { style: { fontWeight: 500, fontSize: "1rem", margin: "0 0 0.25rem" } }, "Preview not available"),
        h("p", { style: { fontSize: "0.85rem", color: "var(--color-muted-foreground, #9ca3af)", margin: "0 0 1rem" } },
          ext.toUpperCase() + " files cannot be displayed in the browser."),
        h("button", { className: "hermes-preview-btn", onClick: handleDownload, style: { padding: "0.5rem 1.5rem" } }, "\u2B07 Download to view"),
      );
      return h("div", { className: "hermes-preview-loading" }, h("div", { className: "hermes-media-spinner" }), h("span", null, "Loading\u2026"));
    }

    return h("div", { className: "hermes-media-preview-overlay", onClick: onClose },
      h("div", { className: "hermes-preview-modal", onClick: function (e) { e.stopPropagation(); } },
        h("div", { className: "hermes-preview-header" },
          h("div", { className: "hermes-preview-title" },
            h("span", { style: { color: ft.color, marginRight: "0.5rem" } }, ft.icon),
            h("span", null, file.name),
            h("span", { className: "hermes-media-count", style: { marginLeft: "0.5rem" } }, formatSize(file.size)),
          ),
          h("div", { className: "hermes-preview-header-actions" },
            h("button", { className: "hermes-preview-btn", onClick: handleDownload }, "\u2B07 Download"),
            h("button", { className: "hermes-preview-close", onClick: onClose }, "\u2715"),
          ),
        ),
        h("div", { className: "hermes-preview-body" }, renderContent()),
        h("div", { className: "hermes-preview-footer" },
          h("span", null, file.mime_type),
          h("span", null, "\u00B7"),
          h("span", null, "Modified " + formatTime(file.mtime)),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Upload zone
  // -------------------------------------------------------------------

  function UploadZone(props) {
    var onUploaded = props.onUploaded;
    var currentPath = props.currentPath;
    var _s1 = useState(false);
    var dragging = _s1[0];
    var setDragging = _s1[1];
    var _s2 = useState(false);
    var uploading = _s2[0];
    var setUploading = _s2[1];
    var _s3 = useState(null);
    var error = _s3[0];
    var setError = _s3[1];
    var _s4 = useState(0);
    var uploadProgress = _s4[0];
    var setUploadProgress = _s4[1];
    var _s5 = useState(0);
    var uploadTotal = _s5[0];
    var setUploadTotal = _s5[1];
    var _s6 = useState(null);
    var success = _s6[0];
    var setSuccess = _s6[1];
    var _s7 = useState(false);
    var copied = _s7[0];
    var setCopied = _s7[1];
    var fileRef = useRef(null);

    function uploadOne(file) {
      var fd = new FormData();
      fd.append("file", file);
      if (currentPath) fd.append("folder", currentPath);
      return authFetch(API + "/upload", { method: "POST", body: fd })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          return data;
        });
    }

    function handleFiles(files) {
      if (!files || !files.length) return;
      var arr = [];
      for (var i = 0; i < files.length; i++) arr.push(files[i]);
      setUploading(true);
      setError(null);
      setSuccess(null);
      setCopied(false);
      setUploadProgress(0);
      setUploadTotal(arr.length);
      var chain = Promise.resolve();
      var firstError = null;
      var lastResult = null;
      var uploadedCount = 0;
      arr.forEach(function (file, idx) {
        chain = chain.then(function () {
          setUploadProgress(idx + 1);
          return uploadOne(file).then(function (data) {
            lastResult = data;
            uploadedCount++;
          }).catch(function (err) {
            if (!firstError) firstError = file.name + ": " + (err.message || "failed");
          });
        });
      });
      chain.then(function () {
        setUploading(false);
        setUploadProgress(0);
        setUploadTotal(0);
        if (firstError) {
          setError(firstError);
          if (lastResult && uploadedCount > 0) {
            setSuccess({ path: lastResult.path, name: lastResult.name, size: lastResult.size, count: uploadedCount });
          }
        } else if (lastResult) {
          setSuccess({ path: lastResult.path, name: lastResult.name, size: lastResult.size, count: uploadedCount });
        }
        onUploaded();
      });
    }

    function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    }
    function onDragOver(e) { e.preventDefault(); e.stopPropagation(); setDragging(true); }
    function onDragLeave(e) { e.preventDefault(); e.stopPropagation(); setDragging(false); }

    function copyPath() {
      if (!success || !success.path) return;
      navigator.clipboard.writeText(success.path).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      }).catch(function () { });
    }

    var statusText = uploading
      ? (uploadTotal > 1 ? "Uploading " + uploadProgress + " / " + uploadTotal + "\u2026" : "Uploading\u2026")
      : null;
    var successLabel = success && success.count > 1 ? success.count + " files uploaded" : "File saved";

    return h("div", { className: "hermes-media-upload" },
      h("div", {
        className: "hermes-media-dropzone" + (dragging ? " dragging" : ""),
        onDrop: onDrop, onDragOver: onDragOver, onDragLeave: onDragLeave,
        onClick: function () { if (!uploading && fileRef.current) fileRef.current.click(); },
      },
        h("input", {
          ref: fileRef, type: "file", multiple: true,
          style: { display: "none" },
          onChange: function () {
            if (fileRef.current && fileRef.current.files.length) {
              handleFiles(fileRef.current.files);
              fileRef.current.value = "";
            }
          },
        }),
        uploading
          ? h("div", { className: "hermes-media-upload-status" },
              h("div", { className: "hermes-media-spinner" }),
              h("span", null, statusText),
            )
          : h("div", { className: "hermes-media-upload-content" },
              h("span", { style: { fontSize: "2rem" } }, "\u2B06"),
              h("span", null, "Drop files here or click to upload"),
              h("span", { className: "hermes-media-upload-hint" }, "Multiple files supported \u00B7 Max 50 MB each"),
            ),
      ),
      error && h("div", { className: "hermes-media-upload-error" }, error),
      success && !uploading && h("div", { className: "heres-media-upload-success" },
        h("div", { className: "hermes-media-upload-success-label" }, "\u2705 ", successLabel),
        h("div", { className: "hermes-media-upload-success-path" }, h("code", null, success.path)),
        h("button", {
          className: "hermes-media-copy-btn" + (copied ? " copied" : ""),
          onClick: copyPath,
        }, copied ? "\u2705 Copied!" : "\uD83D\uDCCB Copy path to clipboard"),
        h("div", { className: "hermes-media-upload-success-hint" },
          "Paste in chat: ", h("code", null, "read " + success.path),
        ),
        h("button", {
          className: "hermes-media-upload-success-dismiss",
          onClick: function () { setSuccess(null); setCopied(false); },
        }, "dismiss"),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Batch action toolbar
  // -------------------------------------------------------------------

  function BatchToolbar(props) {
    var selectedCount = props.selectedCount;
    var onDelete = props.onDelete;
    var onMove = props.onMove;
    var onClear = props.onClear;
    var onDownloadAll = props.onDownloadAll;
    var folders = props.folders;

    if (selectedCount === 0) return null;

    return h("div", { className: "hermes-media-batch-toolbar" },
      h("span", { className: "hermes-media-batch-count" }, selectedCount + " selected"),
      h("button", { className: "hermes-batch-btn", onClick: onDownloadAll }, "\u2B07 Download All"),
      h("button", { className: "hermes-batch-btn danger", onClick: onDelete }, "\u2715 Delete"),
      folders.length > 0 && h("button", { className: "hermes-batch-btn", onClick: onMove }, "\u2191 Move to\u2026"),
      h("button", { className: "hermes-batch-btn", onClick: onClear }, "Clear"),
    );
  }

  // -------------------------------------------------------------------
  // Move dialog
  // -------------------------------------------------------------------

  function MoveDialog(props) {
    var folders = props.folders;
    var onMove = props.onMove;
    var onClose = props.onClose;
    var _sel = useState(null);
    var selectedFolder = _sel[0];
    var setSelectedFolder = _sel[1];

    function handleMove() {
      onMove(selectedFolder); // null = root
    }

    return h("div", { className: "hermes-media-confirm-overlay", onClick: onClose },
      h("div", { className: "hermes-media-confirm-dialog hermes-move-dialog", onClick: function (e) { e.stopPropagation(); } },
        h("h3", null, "Move to folder"),
        h("div", { className: "hermes-move-list" },
          h("div", {
            className: "hermes-move-item" + (selectedFolder === null ? " active" : ""),
            onClick: function () { setSelectedFolder(null); },
          }, "\uD83C\uDFE0 Media (root)"),
          folders.map(function (f) {
            return h("div", {
              key: f.path,
              className: "hermes-move-item" + (selectedFolder === f.path ? " active" : ""),
              onClick: function () { setSelectedFolder(f.path); },
            }, "\uD83D\uDCC1 " + f.name);
          }),
        ),
        h("div", { className: "hermes-media-confirm-buttons" },
          h("button", { className: "cancel", onClick: onClose }, "Cancel"),
          h("button", { className: "confirm", onClick: handleMove,
            style: { background: "#2563eb", borderColor: "#1d4ed8" } }, "Move"),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Main component
  // -------------------------------------------------------------------

  function MediaPlugin() {
    // Data
    var _files = useState([]);
    var files = _files[0];
    var setFiles = _files[1];
    var _folders = useState([]);
    var folders = _folders[0];
    var setFolders = _folders[1];
    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _error = useState(null);
    var error = _error[0];
    var setError = _error[1];
    var _previewFile = useState(null);
    var previewFile = _previewFile[0];
    var setPreviewFile = _previewFile[1];

    // Navigation
    var _currentPath = useState("");
    var currentPath = _currentPath[0];
    var setCurrentPath = _currentPath[1];

    // Selection
    var _selected = useState({});
    var selected = _selected[0];
    var setSelected = _selected[1];

    // Dialogs
    var _showCreateFolder = useState(false);
    var showCreateFolder = _showCreateFolder[0];
    var setShowCreateFolder = _showCreateFolder[1];
    var _showMoveDialog = useState(false);
    var showMoveDialog = _showMoveDialog[0];
    var setShowMoveDialog = _showMoveDialog[1];
    var _showBatchDelete = useState(false);
    var showBatchDelete = _showBatchDelete[0];
    var setShowBatchDelete = _showBatchDelete[1];

    // Fetch files/folders for current path
    var fetchContent = useCallback(function () {
      setLoading(true);
      setError(null);
      var url = API + "/files" + (currentPath ? "?path=" + encodeURIComponent(currentPath) : "");
      SDK.fetchJSON(url)
        .then(function (data) {
          setFiles(data.files || []);
          setFolders(data.folders || []);
          setLoading(false);
        })
        .catch(function (err) {
          setError(err.message || "Failed to load files");
          setLoading(false);
        });
    }, [currentPath]);

    useEffect(function () {
      fetchContent();
      setSelected({});
    }, [fetchContent]);

    // Navigate into folder
    var navigateTo = useCallback(function (path) {
      setCurrentPath(path);
    }, []);

    // File operations
    var handleDelete = useCallback(function (path) {
      SDK.fetchJSON(API + "/file/" + encodeURIComponent(path), { method: "DELETE" })
        .then(function () { fetchContent(); })
        .catch(function (err) { alert("Delete failed: " + (err.message || "Unknown error")); });
    }, [fetchContent]);

    var handleRename = useCallback(function (oldPath, newPath, newName) {
      fetchContent();
    }, [fetchContent]);

    // Folder operations
    var handleDeleteFolder = useCallback(function (path) {
      SDK.fetchJSON(API + "/folder/" + encodeURIComponent(path), { method: "DELETE" })
        .then(function () { fetchContent(); })
        .catch(function (err) { alert("Delete failed: " + (err.message || "Unknown error")); });
    }, [fetchContent]);

    var handleRenameFolder = useCallback(function (oldPath, newPath, newName) {
      fetchContent();
    }, [fetchContent]);

    var handleCreateFolder = useCallback(function () {
      setShowCreateFolder(false);
      fetchContent();
    }, [fetchContent]);

    // Selection
    var toggleSelect = useCallback(function (item) {
      setSelected(function (prev) {
        var next = Object.assign({}, prev);
        if (next[item.path]) {
          delete next[item.path];
        } else {
          next[item.path] = item;
        }
        return next;
      });
    }, []);

    var clearSelection = useCallback(function () { setSelected({}); }, []);

    // Batch download — downloads all selected files (and files inside selected folders)
    var downloadAllFiles = useCallback(function () {
      var paths = Object.keys(selected);
      if (paths.length === 0) return;

      // Separate files and folders
      var selectedFiles = paths.filter(function (p) {
        return files.some(function (f) { return f.path === p; });
      });
      var selectedFolders = paths.filter(function (p) {
        return folders.some(function (f) { return f.path === p; });
      });

      // Collect all file paths to download
      var allFilePaths = selectedFiles.slice();

      // For folders, fetch contents and add their files
      var folderPromises = selectedFolders.map(function (fp) {
        return authFetch(API + "/files?path=" + encodeURIComponent(fp))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.files) {
              data.files.forEach(function (f) { allFilePaths.push(f.path); });
            }
          });
      });

      Promise.all(folderPromises).then(function () {
        if (allFilePaths.length === 0) return;

        // Fetch all file metadata for names
        var fileLookup = {};
        files.forEach(function (f) { fileLookup[f.path] = f.name; });

        var delay = 300; // ms between downloads
        allFilePaths.forEach(function (p, idx) {
          setTimeout(function () {
            var name = fileLookup[p] || p.split("/").pop();
            var url = API + "/file/" + encodeURIComponent(p);
            authFetch(url).then(function (res) { return res.blob(); }).then(function (blob) {
              var a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(a.href);
            });
          }, idx * delay);
        });
      });
    }, [selected, files, folders]);

    var selectedCount = Object.keys(selected).length;

    // Batch delete
    var handleBatchDelete = useCallback(function () {
      var paths = Object.keys(selected);
      var chain = Promise.resolve();
      paths.forEach(function (p) {
        chain = chain.then(function () {
          return SDK.fetchJSON(API + "/file/" + encodeURIComponent(p), { method: "DELETE" });
        });
      });
      chain.then(function () {
        setShowBatchDelete(false);
        setSelected({});
        fetchContent();
      }).catch(function (err) {
        alert("Batch delete failed: " + (err.message));
      });
    }, [selected, fetchContent]);

    // Batch move
    var handleBatchMove = useCallback(function (destFolder) {
      var paths = Object.keys(selected);
      SDK.fetchJSON(API + "/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: paths, dest: destFolder || "" }),
      }).then(function (data) {
        setShowMoveDialog(false);
        setSelected({});
        fetchContent();
      }).catch(function (err) {
        alert("Move failed: " + (err.message));
      });
    }, [selected, fetchContent]);

    // Drag-and-drop: move single file to folder
    var handleDropFile = useCallback(function (filePath, destFolder) {
      SDK.fetchJSON(API + "/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [filePath], dest: destFolder }),
      }).then(function () {
        fetchContent();
      }).catch(function (err) {
        alert("Move failed: " + (err.message));
      });
    }, [fetchContent]);

    var isEmpty = files.length === 0 && folders.length === 0;

    return h("div", { className: "hermes-media" },
      // Header
      h("div", { className: "hermes-media-header" },
        h("div", { className: "hermes-media-header-left" },
          h("h2", null, "Media Files"),
          !isEmpty && h("span", { className: "hermes-media-count" }, (files.length + folders.length)),
        ),
        h("div", { className: "hermes-media-header-actions" },
          h(Button, { onClick: function () { setShowCreateFolder(true); }, variant: "outline", size: "sm" }, "\uD83D\uDCC1 New Folder"),
          h(Button, { onClick: fetchContent, variant: "outline", size: "sm" }, "\u21BB Refresh"),
        ),
      ),

      // Breadcrumbs
      h(Breadcrumbs, { currentPath: currentPath, onNavigate: navigateTo }),

      // Upload zone
      h(UploadZone, { onUploaded: fetchContent, currentPath: currentPath }),

      // Batch toolbar
      h(BatchToolbar, {
        selectedCount: selectedCount,
        folders: folders,
        onDelete: function () { setShowBatchDelete(true); },
        onMove: function () { setShowMoveDialog(true); },
        onClear: clearSelection,
        onDownloadAll: downloadAllFiles,
      }),

      // Error
      error && files.length === 0 && h("div", { className: "hermes-media-error" },
        error,
        h("div", { style: { marginTop: "0.75rem" } },
          h(Button, { onClick: fetchContent, variant: "outline", size: "sm" }, "Retry"),
        ),
      ),

      // Loading
      loading && files.length === 0 && h("div", { className: "hermes-media-loading" }, "Loading media files\u2026"),

      // Grid: folders first, then files
      !loading && !error && !isEmpty && h("div", { className: "hermes-media-grid" },
        // Folder cards
        folders.map(function (folder) {
          return h(FolderCard, {
            key: "folder-" + folder.path,
            folder: folder,
            onOpen: navigateTo,
            onDelete: handleDeleteFolder,
            onRename: handleRenameFolder,
            onDropFile: handleDropFile,
            selected: !!selected[folder.path],
            onSelect: toggleSelect,
          });
        }),
        // File cards
        files.map(function (file) {
          return h(FileCard, {
            key: file.path,
            file: file,
            onDelete: handleDelete,
            onPreview: setPreviewFile,
            onRename: handleRename,
            selected: !!selected[file.path],
            onSelect: toggleSelect,
          });
        }),
      ),

      // Empty
      !loading && !error && isEmpty && h("div", { className: "hermes-media-empty" },
        h("div", { className: "hermes-media-empty-icon" }, "\uD83D\uDCC1"),
        h("p", { style: { fontWeight: 500, fontSize: "1rem" } }, "No media files yet"),
        h("p", null, "Upload files above or add files to /data/media"),
      ),

      // Preview modal
      previewFile && h(PreviewModal, {
        file: previewFile,
        onClose: function () { setPreviewFile(null); },
      }),

      // Create folder dialog
      showCreateFolder && h(CreateFolderDialog, {
        parentPath: currentPath,
        onClose: function () { setShowCreateFolder(false); },
        onCreated: handleCreateFolder,
      }),

      // Batch delete confirm
      showBatchDelete && h(ConfirmDialog, {
        title: "Delete " + selectedCount + " files?",
        message: "This will permanently delete " + selectedCount + " selected files.",
        confirmLabel: "Delete All",
        onConfirm: handleBatchDelete,
        onCancel: function () { setShowBatchDelete(false); },
      }),

      // Move dialog
      showMoveDialog && h(MoveDialog, {
        folders: folders,
        onMove: handleBatchMove,
        onClose: function () { setShowMoveDialog(false); },
      }),
    );
  }

  // -------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("media", MediaPlugin);
  }
})();
