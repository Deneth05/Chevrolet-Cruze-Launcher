/* Tiny inline icon set (24×24, stroke based). Keeps the APK small – no icon fonts. */
(function () {
  function gear() {
    var d = '', n = 8, R = 10, r = 7.6, cx = 12, cy = 12;
    for (var i = 0; i < n * 4; i++) {
      var a = (i / (n * 4)) * Math.PI * 2 - Math.PI / 2;
      var rad = (i % 4 === 0 || i % 4 === 1) ? R : r;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rad).toFixed(2) + ' ' + (cy + Math.sin(a) * rad).toFixed(2);
    }
    return d + 'Z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z';
  }
  var sun = 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4';
  window.ICONS = {
    home: 'M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10',
    nav: 'M12 2.5l7.5 19-7.5-4.2-7.5 4.2z',
    music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
    video: 'M3.5 5.5h17a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17V7a1.5 1.5 0 0 1 1.5-1.5z M10 9.3v5.4l4.6-2.7z',
    phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
    radio: 'M3 9h18v11H3z M7 9l10-5 M7 14.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z M15 13h3 M15 16.5h3',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c3.2 3.5 3.2 14.5 0 18 M12 3c-3.2 3.5-3.2 14.5 0 18',
    settings: gear(),
    apps: 'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z M15 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    play: '!M8 5.5v13l10.5-6.5z',
    pause: '!M7 5h3.5v14H7z M13.5 5H17v14h-3.5z',
    prev: '!M6 5h2.4v14H6z M19 5v14L9 12z',
    next: '!M15.6 5H18v14h-2.4z M5 5v14l10-7z',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
    sliders: 'M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    sun: sun,
    auto: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M8.5 16L12 7.5l3.5 8.5 M9.7 13h4.6',
    engine: 'M3 10h2V8h3l2-2h5v2h3l2 3v5h-2v2h-3l-2-2h-5l-2-2H5v-2H3z M12 10v3',
    thermo: 'M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z M12 10v6',
    battery: 'M3 8h18v12H3z M6 8V5.5h3V8 M15 8V5.5h3V8 M6.5 14h3 M14.5 14h3 M16 12.5v3',
    fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16 M3 21h12 M6 9h6 M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3',
    gauge: 'M4 17a8 8 0 1 1 16 0 M12 17l4-5 M6.5 11.5l1 .7 M12 9v1.2',
    pin: 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 1 1 13 0c0 5.3-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
    bt: 'M7 7l10 10-5 5V2l5 5L7 17',
    wifi: 'M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01',
    gps: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
    obd: 'M9 2v5 M15 2v5 M6 7h12v4a6 6 0 0 1-12 0z M12 17v5',
    close: 'M6 6l12 12 M18 6L6 18',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20.5 20.5l-4.5-4.5',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    starf: '!M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    alert: 'M12 3.5L2.5 20h19z M12 10v4.5 M12 17.3h.01',
    wrench: 'M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9L11 21.8a2.3 2.3 0 0 1-3.3-3.3l9.6-9.6 M14.7 6.3l3-3 M14.7 6.3a4.5 4.5 0 0 1 3-3',
    light: 'M10 5c-4 0-7 3-7 7s3 7 7 7c2.2 0 3.5-3 3.5-7S12.2 5 10 5z M17 8h5 M17 12h5 M17 16h5',
    volume: 'M4 9h4l5-4v14l-5-4H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a8 8 0 0 1 0 11',
    color: 'M12 3a9 9 0 0 0 0 18c1.2 0 2-.8 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.8C21 6 17 3 12 3z M7.5 11.5h.01 M10 7.5h.01 M15 7.5h.01'
  };

  window.icon = function (name, cls) {
    var d = ICONS[name] || '';
    var filled = d.charAt(0) === '!';
    if (filled) d = d.slice(1);
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '" ' +
      (filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"') +
      '/></svg>';
  };

  window.hydrateIcons = function (root) {
    var els = (root || document).querySelectorAll('i[data-icon]');
    for (var i = 0; i < els.length; i++) els[i].innerHTML = icon(els[i].getAttribute('data-icon'));
  };

  /* Animated weather glyphs */
  window.weatherIcon = function (kind, day) {
    var sunG = '<g class="wx-sun"><circle cx="32" cy="32" r="11" fill="#ffb627"/>' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
        return '<rect x="30.5" y="8" width="3" height="8" rx="1.5" fill="#ffb627" transform="rotate(' + a + ' 32 32)"/>';
      }).join('') + '</g>';
    var moonG = '<path d="M40 40A14 14 0 0 1 26 18a14 14 0 1 0 14 22z" fill="#ffd98a"/>';
    var cloud = function (x, y, c) { return '<path transform="translate(' + x + ' ' + y + ')" d="M14 34h26a9 9 0 0 0 0-18 13 13 0 0 0-25-2A10 10 0 0 0 14 34z" fill="' + (c || '#cfd6de') + '"/>'; };
    var drops = '<g class="wx-rain" stroke="#5ab4ff" stroke-width="3" stroke-linecap="round"><path d="M22 50l-3 7"/><path d="M32 50l-3 7"/><path d="M42 50l-3 7"/></g>';
    var bolt = '<path class="wx-bolt" d="M33 44l-6 10h6l-3 8 9-12h-6l3-6z" fill="#ffd23f"/>';
    var s = '';
    switch (kind) {
      case 'clear': s = day ? sunG : moonG; break;
      case 'partly': s = '<g transform="translate(-8 -8) scale(.85)">' + (day ? sunG : moonG) + '</g>' + cloud(4, 4); break;
      case 'cloud': s = cloud(-2, -2, '#9aa4ae') + cloud(6, 6); break;
      case 'fog': s = cloud(2, -4) + '<g stroke="#aab3bc" stroke-width="3" stroke-linecap="round"><path d="M14 46h36"/><path d="M18 53h28"/></g>'; break;
      case 'rain': case 'drizzle': s = cloud(2, -4, '#aeb7c0') + drops; break;
      case 'storm': s = cloud(2, -6, '#8a939c') + bolt; break;
      case 'snow': s = cloud(2, -4) + '<g fill="#fff"><circle cx="22" cy="52" r="2.5"/><circle cx="32" cy="56" r="2.5"/><circle cx="42" cy="52" r="2.5"/></g>'; break;
      default: s = cloud(2, 2);
    }
    return '<svg viewBox="0 0 64 64" aria-hidden="true">' + s + '</svg>';
  };
})();
