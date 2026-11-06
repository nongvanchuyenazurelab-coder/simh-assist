(function() {
  'use strict';
  var lastSentUrl = '';

  function logTrace(from, msg, url) {
    try {
      var sub = (window.location.hostname || '').split('.')[0] || '';
      var traceUrl = '/_mgr/trace?from=' + encodeURIComponent(from) +
                     '&sub=' + encodeURIComponent(sub) +
                     '&msg=' + encodeURIComponent(msg || '') +
                     '&url=' + encodeURIComponent(url || window.location.href);
      if (window.fetch) {
        window.fetch(traceUrl).catch(function() {});
      } else {
        var img = new Image();
        img.src = traceUrl;
      }
    } catch(e) {}
  }

  logTrace('frame_injected_head', 'script_start', window.location.href);

  function notifyParentUrl() {
    try {
      var currentUrl = window.location.href;
      var cleanUrl = currentUrl.replace(/([?&])_v=\d+(&|$)/, '$1').replace(/[?&]$/, '');
      if (cleanUrl === lastSentUrl) return;
      var prevUrl = lastSentUrl;
      lastSentUrl = cleanUrl;
      var sub = (window.location.hostname || '').split('.')[0] || '';
      logTrace('frame_url_changed', 'prev=' + prevUrl, cleanUrl);

      var msg = {
        type: 'YTCS_URL_CHANGED',
        tabId: window.name || '',
        subdomain: sub,
        url: cleanUrl,
        pathname: window.location.pathname,
        search: window.location.search || '',
        hash: window.location.hash || '',
        title: document.title || ''
      };

      if (window.top && window.top !== window) {
        window.top.postMessage(msg, '*');
      }
      if (window.parent && window.parent !== window && window.parent !== window.top) {
        window.parent.postMessage(msg, '*');
      }
    } catch(e) {
      logTrace('frame_notify_err', e.message, window.location.href);
    }
  }

  // Hook HTML5 History API (pushState & replaceState)
  var origPush = history.pushState ? history.pushState.bind(history) : null;
  var origReplace = history.replaceState ? history.replaceState.bind(history) : null;
  if (origPush) {
    history.pushState = function() {
      var res = origPush.apply(this, arguments);
      logTrace('frame_pushState', arguments[2] || '', window.location.href);
      setTimeout(notifyParentUrl, 0);
      return res;
    };
  }
  if (origReplace) {
    history.replaceState = function() {
      var res = origReplace.apply(this, arguments);
      logTrace('frame_replaceState', arguments[2] || '', window.location.href);
      setTimeout(notifyParentUrl, 0);
      return res;
    };
  }

  // Hook Single-SPA và các sự kiện điều hướng của trình duyệt
  window.addEventListener('popstate', function() { logTrace('frame_popstate', '', window.location.href); setTimeout(notifyParentUrl, 0); });
  window.addEventListener('hashchange', function() { logTrace('frame_hashchange', '', window.location.href); setTimeout(notifyParentUrl, 0); });
  window.addEventListener('single-spa:routing-event', function() { logTrace('frame_single_spa_routing', '', window.location.href); setTimeout(notifyParentUrl, 0); });
  window.addEventListener('single-spa:before-routing-event', function() { setTimeout(notifyParentUrl, 30); });
  window.addEventListener('load', function() { logTrace('frame_load', '', window.location.href); setTimeout(notifyParentUrl, 30); });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    notifyParentUrl();
  } else {
    document.addEventListener('DOMContentLoaded', notifyParentUrl);
  }

  // Polling interval (300ms) đảm bảo tuyệt đối bắt được mọi chuyển trang nội bộ Single-SPA
  setInterval(notifyParentUrl, 300);
  setTimeout(notifyParentUrl, 50);

  // Hook window.fetch và XMLHttpRequest để in log API trực tiếp vào DevTools Console và thông báo lên parent
  (function hookApiLogger() {
    var TARGET_API_HOST = 'ytcs-gw.hmis.vn';
    var TARGET_HOST = 'ytcs.hmis.vn';

    function rewriteDmsUrl(url) {
      if (!url || typeof url !== 'string') return url;
      // Khắc phục triệt để lỗi CORS khi xem/in PDF từ dms-hisl4.vnpt.vn
      if (/^https?:\/\/dms[-a-z0-9]*\.vnpt\.vn\//i.test(url)) {
        return '/dms-proxy?target=' + encodeURIComponent(url);
      }
      return url;
    }

    function getRealFrameUrl() {
      try {
        var u = window.location.href;
        return u.replace(/http:\/\/[a-zA-Z0-9_.-]+:8888/g, 'https://' + TARGET_HOST);
      } catch(e) {
        return 'https://' + TARGET_HOST;
      }
    }

    function getRealApiUrl(url) {
      try {
        if (!url) return '';
        var str = String(url);
        if (str.startsWith('http://') || str.startsWith('https://')) {
          return str.replace(/http:\/\/[a-zA-Z0-9_.-]+:8888\/api\//g, 'https://' + TARGET_API_HOST + '/api/');
        }
        if (str.startsWith('/api/')) {
          return 'https://' + TARGET_API_HOST + str;
        }
        return str;
      } catch(e) {
        return url;
      }
    }

    function buildCurl(method, url, headers, body) {
      var parts = ['curl -X ' + method + ' "' + url + '"'];
      if (headers) {
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
          headers.forEach(function(val, key) {
            var lk = key.toLowerCase();
            if (['authorization', 'region-code', 'tenant-code', 'content-type', 'accept'].indexOf(lk) !== -1) {
              parts.push('  -H "' + key + ': ' + val + '"');
            }
          });
        } else if (typeof headers === 'object') {
          for (var k in headers) {
            var lk = k.toLowerCase();
            if (['authorization', 'region-code', 'tenant-code', 'content-type', 'accept'].indexOf(lk) !== -1) {
              parts.push('  -H "' + k + ': ' + headers[k] + '"');
            }
          }
        }
      }
      if (body && ['POST', 'PUT', 'PATCH'].indexOf(method) !== -1) {
        var bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        if (bodyStr) {
          parts.push('  --data-raw ' + JSON.stringify(bodyStr));
        }
      }
      return parts.join(' \\\n');
    }

    function notifyApiCall(data) {
      try {
        var msg = {
          type: 'YTCS_API_LOG',
          data: data
        };
        if (window.top && window.top !== window) window.top.postMessage(msg, '*');
        if (window.parent && window.parent !== window && window.parent !== window.top) window.parent.postMessage(msg, '*');
      } catch(e) {}
    }

    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init) {
        try {
          var url = '';
          var method = 'GET';
          var body = null;
          var headers = {};

          if (typeof input === 'string') {
            var rw = rewriteDmsUrl(input);
            if (rw !== input) {
              input = rw;
            }
            url = input;
            if (init) {
              method = init.method || 'GET';
              body = init.body || null;
              headers = init.headers || {};
            }
          } else if (input && typeof input === 'object') {
            if (input.url) {
              var rw = rewriteDmsUrl(input.url);
              if (rw !== input.url) {
                try {
                  input = new Request(rw, input);
                } catch(e) {
                  input.url = rw;
                }
              }
            }
            url = input.url || '';
            method = (init && init.method) || input.method || 'GET';
            body = (init && init.body) || input.body || null;
            headers = (init && init.headers) || input.headers || {};
          }

          if (url && (url.indexOf('/api/') !== -1)) {
            method = String(method).toUpperCase();
            var realApi = getRealApiUrl(url);
            var realFrame = getRealFrameUrl();
            var curlCmd = buildCurl(method, realApi, headers, body);

            console.groupCollapsed(
              '%c[API] %c' + method + ' %c' + realApi,
              'background:#0284c7;color:#fff;font-weight:bold;padding:1px 5px;border-radius:3px;',
              'background:#16a34a;color:#fff;font-weight:bold;padding:1px 5px;border-radius:3px;',
              'color:#0f172a;font-weight:600;'
            );
            console.log('%c🌐 URL API gốc (Gateway):', 'font-weight:bold;color:#0284c7;', realApi);
            console.log('%c📄 URL Frame hiện tại:', 'font-weight:bold;color:#7c3aed;', realFrame);
            console.log('%c📋 Lệnh cURL chuẩn (dùng ngay):', 'font-weight:bold;color:#ea580c;', curlCmd);
            if (body) {
              try {
                console.log('%c📤 Request Body:', 'font-weight:bold;', typeof body === 'string' ? JSON.parse(body) : body);
              } catch(e) {
                console.log('%c📤 Request Body:', 'font-weight:bold;', body);
              }
            }
            console.groupEnd();

            if (typeof input === 'string') {
              init = init || {};
              if (init.headers instanceof Headers) {
                init.headers.set('x-client-frame-url', window.location.href);
              } else if (Array.isArray(init.headers)) {
                init.headers.push(['x-client-frame-url', window.location.href]);
              } else if (typeof init.headers === 'object') {
                init.headers = Object.assign({}, init.headers, { 'x-client-frame-url': window.location.href });
              } else {
                init.headers = { 'x-client-frame-url': window.location.href };
              }
            }

            notifyApiCall({
              subdomain: (window.location.hostname || '').split('.')[0] || '',
              method: method,
              realApiUrl: realApi,
              realFrameUrl: realFrame,
              curl: curlCmd,
              body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : ''),
              timestamp: Date.now()
            });
          }
        } catch(e) {}
        return origFetch.apply(this, arguments);
      };
    }

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
      var targetUrl = url;
      try {
        if (typeof url === 'string') {
          targetUrl = rewriteDmsUrl(url);
        }
      } catch(e) {}
      this._ytcs_method = method;
      this._ytcs_url = targetUrl;
      this._ytcs_headers = {};
      var args = Array.prototype.slice.call(arguments);
      args[1] = targetUrl;
      return origOpen.apply(this, args);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      if (!this._ytcs_headers) this._ytcs_headers = {};
      this._ytcs_headers[name] = value;
      return origSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      try {
        var url = this._ytcs_url;
        if (url && (String(url).indexOf('/api/') !== -1)) {
          var method = String(this._ytcs_method || 'GET').toUpperCase();
          var realApi = getRealApiUrl(url);
          var realFrame = getRealFrameUrl();
          var curlCmd = buildCurl(method, realApi, this._ytcs_headers, body);

          try {
            origSetHeader.call(this, 'x-client-frame-url', window.location.href);
          } catch(e) {}

          console.groupCollapsed(
            '%c[API/XHR] %c' + method + ' %c' + realApi,
            'background:#0284c7;color:#fff;font-weight:bold;padding:1px 5px;border-radius:3px;',
            'background:#16a34a;color:#fff;font-weight:bold;padding:1px 5px;border-radius:3px;',
            'color:#0f172a;font-weight:600;'
          );
          console.log('%c🌐 URL API gốc (Gateway):', 'font-weight:bold;color:#0284c7;', realApi);
          console.log('%c📄 URL Frame hiện tại:', 'font-weight:bold;color:#7c3aed;', realFrame);
          console.log('%c📋 Lệnh cURL chuẩn (dùng ngay):', 'font-weight:bold;color:#ea580c;', curlCmd);
          if (body) {
            try {
              console.log('%c📤 Request Body:', 'font-weight:bold;', typeof body === 'string' ? JSON.parse(body) : body);
            } catch(e) {
              console.log('%c📤 Request Body:', 'font-weight:bold;', body);
            }
          }
          console.groupEnd();

          notifyApiCall({
            subdomain: (window.location.hostname || '').split('.')[0] || '',
            method: method,
            realApiUrl: realApi,
            realFrameUrl: realFrame,
            curl: curlCmd,
            body: typeof body === 'string' ? body : (body ? JSON.stringify(body) : ''),
            timestamp: Date.now()
          });
        }
      } catch(e) {}
      return origSend.apply(this, arguments);
    };

    // Hook window.open nếu mở trực tiếp link dms-hisl4.vnpt.vn
    try {
      var origWindowOpen = window.open;
      if (origWindowOpen) {
        window.open = function(url, target, features) {
          try {
            if (typeof url === 'string') {
              url = rewriteDmsUrl(url);
            }
          } catch(e) {}
          return origWindowOpen.call(window, url, target, features);
        };
      }
    } catch(e) {}

    // Bắt và chuyển tiếp click trên thẻ <a> chứa link dms-hisl4.vnpt.vn
    try {
      document.addEventListener('click', function(e) {
        var target = e.target;
        while (target && target !== document) {
          if (target.tagName === 'A' && target.href) {
            var rw = rewriteDmsUrl(target.href);
            if (rw !== target.href) {
              target.href = rw;
            }
          }
          target = target.parentNode;
        }
      }, true);
    } catch(e) {}

    // Hook setAttribute trên iframe / embed / object để nạp PDF qua /dms-proxy
    try {
      var origSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (name && (name.toLowerCase() === 'src' || name.toLowerCase() === 'href' || name.toLowerCase() === 'data') && typeof value === 'string') {
          value = rewriteDmsUrl(value);
        }
        return origSetAttribute.call(this, name, value);
      };
    } catch(e) {}
  })();
})();
