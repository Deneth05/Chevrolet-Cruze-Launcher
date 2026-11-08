/* Cruze Launcher – UI logic.
 * Runs inside the Android WebView (window.Android bridge) or in any browser (demo mode).
 * Native → JS callbacks live on window.CL.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var A = window.Android || null;          // native bridge (null in browser preview)
  var NATIVE = !!A;

  /* ───────────────────────── Settings ───────────────────────── */
  var COLORS = {
    silver: { name: 'Silky Silver', body: '#c3c8ce', accent: '#38bdf8' },
    gray: { name: 'Granite Gray', body: '#6b7178', accent: '#22d3ee' },
    black: { name: 'Bluish Black', body: '#1b1e23', accent: '#f59e0b' },
    white: { name: 'Pearl White', body: '#eef0f2', accent: '#3b82f6' },
    maroon: { name: 'Maroon', body: '#6e1423', accent: '#ff6a3d' },
    red: { name: 'Super Red', body: '#b8141f', accent: '#ff7a2f' },
    blue: { name: 'Cosmic Blue', body: '#1f4fa3', accent: '#60a5fa' },
    green: { name: 'Forest Green', body: '#2f5d3a', accent: '#4ade80' },
    gold: { name: 'Champagne Gold', body: '#b9a37a', accent: '#fbbf24' }
  };
  var DEF = {
    theme: 'auto', color: 'silver', perf: 'auto', clock24: false, lightsMode: 'auto',
    units: 'kmh', limitOn: true, limit: 100, serviceKm: 5000, odo: 0, serviceStart: 0,
    gpsWeather: true, city: { name: 'Colombo', lat: 6.9271, lon: 79.8612 },
    navPkg: '', musicPkg: '', videoPkg: '', obdAddr: '', favs: [], lastStation: null,
    demo: !NATIVE
  };
  var S = load('cl.settings', DEF);
  for (var k in DEF) if (!(k in S)) S[k] = DEF[k];
  function load(key, def) { try { var v = JSON.parse(localStorage.getItem(key)); return v || JSON.parse(JSON.stringify(def)); } catch (e) { return JSON.parse(JSON.stringify(def)); } }
  function save() { try { localStorage.setItem('cl.settings', JSON.stringify(S)); } catch (e) { } }

  /* ───────────────────────── Live state ───────────────────────── */
  var st = {
    speed: 0, shown: 0, rpm: 0, heading: null, src: 'GPS',
    gpsAt: 0, obdAt: 0,
    tripKm: 0, movingMs: 0, maxSpeed: 0, startedAt: Date.now(),
    lights: false, nightSys: null, lux: null,
    obd: { state: 'off', cool: null, volt: null, fuel: null, load: null, thr: null, iat: null },
    dtcs: null, media: null, radio: { list: [], idx: -1, playing: false, station: null },
    sun: null, wx: null, prevSpeed: 0, brakeUntil: 0, overAlerted: false
  };

  /* ───────────────────────── Helpers ───────────────────────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + pad(sec % 60); }
  function unitK() { return S.units === 'mph' ? 0.621371 : 1; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hexRgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)].join(', '); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function call(fn) { if (!A || typeof A[fn] !== 'function') return null; try { return A[fn].apply(A, [].slice.call(arguments, 1)); } catch (e) { console.warn(fn, e); return null; } }
  function getJSON(url, cb, timeout) {
    var x = new XMLHttpRequest(); x.open('GET', url); x.timeout = timeout || 12000;
    x.onload = function () { if (x.status >= 200 && x.status < 300) { try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); } } else cb(new Error('HTTP ' + x.status)); };
    x.onerror = x.ontimeout = function () { cb(new Error('network')); };
    x.send();
  }

  /* ───────────────────────── Appearance ───────────────────────── */
  function applyColor() {
    var c = COLORS[S.color] || COLORS.silver;
    var r = document.documentElement.style;
    r.setProperty('--car', c.body);
    r.setProperty('--accent', c.accent);
    r.setProperty('--accent-rgb', hexRgb(c.accent));
    $('carColorName').textContent = c.name;
    qa('.swatch').forEach(function (s) { s.classList.toggle('on', s.dataset.c === S.color); });
  }

  function isNightBySun() {
    var now = Date.now();
    if (st.sun) return now < st.sun.rise || now > st.sun.set;
    var h = new Date().getHours() + new Date().getMinutes() / 60;
    return h < 6 || h >= 18.3;
  }

  function computeLights() {
    if (st.manualLights != null) return st.manualLights;
    if (S.lightsMode === 'off') return false;
    if (S.lightsMode === 'auto') {
      if (st.nightSys != null) return st.nightSys;          // head unit illumination wire → system night mode
      if (st.lux != null) return st.lux < 12;               // ambient light sensor
    }
    return isNightBySun();
  }

  function applyTheme() {
    st.lights = computeLights();
    var dark = S.theme === 'night' || (S.theme === 'auto' && (st.lights || isNightBySun()));
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    document.body.classList.toggle('lights-on', st.lights);
    $('chipLights').classList.toggle('on', st.lights);
    var b = $('btnTheme');
    var lbl = S.theme === 'auto' ? 'AUTO' : (S.theme === 'night' ? 'NIGHT' : 'DAY');
    b.innerHTML = icon(S.theme === 'auto' ? 'auto' : (S.theme === 'night' ? 'moon' : 'sun')) + '<span>' + lbl + '</span>';
    $('qLightsTxt').textContent = 'Lights: ' + (st.manualLights == null ? 'auto' : (st.manualLights ? 'on' : 'off'));
  }

  function applyPerf() {
    var lite = S.perf === 'lite';
    if (S.perf === 'auto') {
      var info = st.info || {};
      lite = !!info.lowRam || (navigator.deviceMemory && navigator.deviceMemory <= 2) || false;
    }
    document.body.classList.toggle('lite', lite);
    st.lite = lite;
  }

  /* ───────────────────────── Clock ───────────────────────── */
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var lastMin = -1;
  function tickClock() {
    var d = new Date(), m = d.getMinutes(), h = d.getHours();
    if (m === lastMin) return;
    lastMin = m;
    if (S.clock24) { $('time').textContent = pad(h) + ':' + pad(m); $('ampm').textContent = ''; }
    else { $('time').textContent = ((h % 12) || 12) + ':' + pad(m); $('ampm').textContent = h < 12 ? 'AM' : 'PM'; }
    $('greeting').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
    $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    applyTheme();
  }

  /* ───────────────────────── Gauge ───────────────────────── */
  var MAXS = 180, NT = 55, ticks = [];
  function angFor(v, max) { return 135 + (v / max) * 270; }
  function polar(a, r) { var t = a * Math.PI / 180; return [150 + Math.cos(t) * r, 150 + Math.sin(t) * r]; }
  function buildGauge() {
    var g = '', l = '';
    for (var i = 0; i < NT; i++) {
      var a = 135 + (i / (NT - 1)) * 270, p1 = polar(a, 112), p2 = polar(a, 128);
      g += '<line class="tk' + (i % 9 === 0 ? ' major' : '') + '" x1="' + p1[0].toFixed(1) + '" y1="' + p1[1].toFixed(1) + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '"/>';
    }
    $('gTicks').innerHTML = g;
    ticks = qa('#gTicks .tk');
    var max = S.units === 'mph' ? 120 : MAXS, step = S.units === 'mph' ? 40 : 60;
    for (var v = 0; v <= max; v += step) { var p = polar(angFor(v, max), 145); l += '<text class="lbl" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '">' + v + '</text>'; }
    $('gLabels').innerHTML = l;
    $('speedUnit').textContent = S.units === 'mph' ? 'MPH' : 'KM/H';
    var lim = S.limit * unitK(), la = angFor(Math.min(lim, max), max);
    $('limitMark').setAttribute('transform', 'rotate(' + (la + 90) + ' 150 150)');
    $('limitMark').style.display = S.limitOn ? '' : 'none';
    $('stLimit').textContent = S.limitOn ? Math.round(lim) : 'off';
  }
  var lastOn = -1, lastOver = null;
  function renderGauge(kmh) {
    var v = kmh * unitK(), max = S.units === 'mph' ? 120 : MAXS;
    $('speedNum').textContent = Math.round(v);
    var on = Math.round(Math.min(v, max) / max * (NT - 1)) + (v > 0.5 ? 1 : 0);
    var over = S.limitOn && kmh > S.limit;
    if (on !== lastOn || over !== lastOver) {
      for (var i = 0; i < NT; i++) { ticks[i].classList.toggle('on', i < on && !over); ticks[i].classList.toggle('over', i < on && over); }
      lastOn = on; lastOver = over;
      $('speedCard').classList.toggle('over', over);
    }
  }
  function renderRpm(rpm) {
    var pct = Math.min(rpm / 7000, 1) * 75;
    var arc = $('rpmArc');
    arc.style.strokeDasharray = pct.toFixed(1) + ' 100';
    arc.classList.toggle('red', rpm > 6000);
    $('rpmTxt').textContent = (rpm / 1000).toFixed(1);
  }

  /* ───────────────────────── Speed input ───────────────────────── */
  function setSpeed(kmh, src) {
    if (src === 'GPS' && Date.now() - st.obdAt < 3000) return; // OBD wins when live
    st.speed = Math.max(0, kmh);
    st.src = src;
    if (st.speed > st.maxSpeed) st.maxSpeed = st.speed;
    $('speedSrc').textContent = src;
    // brake light: strong deceleration
    if (st.prevSpeed - st.speed > 3) st.brakeUntil = Date.now() + 1200;
    st.prevSpeed = st.speed;
    checkOverspeed();
  }
  var beepCtx;
  function beep() {
    try {
      beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = beepCtx.createOscillator(), g = beepCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(beepCtx.destination);
      g.gain.setValueAtTime(0.0001, beepCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, beepCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, beepCtx.currentTime + 0.35);
      o.start(); o.stop(beepCtx.currentTime + 0.4);
    } catch (e) { }
  }
  function checkOverspeed() {
    if (!S.limitOn) return;
    if (st.speed > S.limit && !st.overAlerted) { st.overAlerted = true; beep(); setTimeout(beep, 450); }
    if (st.speed < S.limit - 5) st.overAlerted = false;
  }

  var HEAD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function headingTxt(b) { return b == null ? '—' : HEAD[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }

  function renderStats() {
    var k = unitK(), u = S.units === 'mph' ? ' mi' : ' km';
    $('stTrip').textContent = (st.tripKm * k).toFixed(1) + u;
    var min = Math.floor((Date.now() - st.startedAt) / 60000);
    $('stDrive').textContent = min < 60 ? min + ' min' : Math.floor(min / 60) + 'h ' + pad(min % 60);
    $('stHead').textContent = headingTxt(st.heading);
    var avg = st.movingMs > 0 ? st.tripKm / (st.movingMs / 3600000) : 0;
    $('stAvg').textContent = Math.round(avg * k);
    $('stMax').textContent = Math.round(st.maxSpeed * k);
    // service reminder
    var left = S.serviceKm - (S.odo - S.serviceStart);
    var sv = $('vService');
    sv.textContent = left > 0 ? 'Service in ' + Math.round(left * k).toLocaleString() + u : 'Service due ' + Math.round(-left * k).toLocaleString() + u + ' ago';
    sv.parentNode.classList.toggle('due', left < 300);
  }

  /* ───────────────────────── Car animation loop ───────────────────────── */
  var rimR = $('rimR'), rimF = $('rimF'), carEl = $('car'), body = $('carBody'), dash = $('roadDash'), stage = $('carStage');
  var wheelA = 0, dashX = 0, lastT = 0, bobT = 0, lastDraw = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    var minDt = st.lite ? 40 : 16;               // ~25fps in lite mode
    if (t - lastDraw < minDt) return;
    var dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t; lastDraw = t;

    // integrate trip
    if (st.speed > 1) { var km = st.speed * dt / 3600; st.tripKm += km; S.odo += km; st.movingMs += dt * 1000; }

    // smooth displayed speed
    var diff = st.speed - st.shown;
    if (Math.abs(diff) > 0.05) { st.shown += diff * Math.min(1, dt * 4); renderGauge(st.shown); }
    else if (st.shown !== st.speed) { st.shown = st.speed; renderGauge(st.shown); }

    var v = st.shown;
    var moving = v > 0.8;
    // wheels: tyre circumference ≈ 1.75 m  → rev/s = (km/h / 3.6) / 1.75 ; cap for stroboscopic sanity
    var revs = Math.min(v / 3.6 / 1.75, 3.2);
    wheelA = (wheelA + revs * 360 * dt) % 360;
    if (moving || wheelA) {
      var tr = 'rotate(' + wheelA.toFixed(1) + ')';
      rimR.setAttribute('transform', tr); rimF.setAttribute('transform', tr);
    }
    // body bob + road dash
    if (moving) {
      bobT += dt * (2 + v / 25);
      var bob = Math.sin(bobT * 3.1) * Math.min(1.6, v / 50) + Math.sin(bobT * 7.3) * 0.25;
      body.setAttribute('transform', 'translate(0 ' + bob.toFixed(2) + ')');
      dashX = (dashX + v * dt * 9) % 160;
      dash.setAttribute('stroke-dashoffset', dashX.toFixed(1));
    }
    if (moving !== st.wasMoving) { stage.classList.toggle('moving', moving && v > 20); st.wasMoving = moving; if (!moving) body.removeAttribute('transform'); }
    else if (moving) stage.classList.toggle('moving', v > 20);
    carEl.classList.toggle('braking', Date.now() < st.brakeUntil);
  }

  /* ───────────────────────── Media card ───────────────────────── */
  function renderMedia() {
    var m = st.radio.playing || (st.radio.station && !st.media) ? radioMedia() : st.media;
    var card = $('mediaCard');
    if (!m) {
      $('mSource').textContent = 'Now playing';
      $('mTitle').textContent = 'Nothing playing';
      $('mArtist').textContent = NATIVE ? 'Play music on your phone or open Radio' : 'Tap play or open Radio';
      $('mBar').style.width = '0'; $('mPos').textContent = '0:00'; $('mDur').textContent = '0:00';
      setPlayIcon(false); card.classList.remove('playing'); setArt(null); return;
    }
    $('mSource').textContent = m.source || 'Now playing';
    $('mTitle').textContent = m.title || 'Unknown';
    $('mArtist').textContent = m.artist || '';
    if (m.live) { $('mBar').style.width = '100%'; $('mPos').textContent = 'LIVE'; $('mDur').textContent = m.bitrate ? m.bitrate + ' kbps' : ''; }
    else {
      var pos = m.pos || 0, dur = m.dur || 0;
      $('mBar').style.width = dur ? Math.min(100, pos / dur * 100).toFixed(1) + '%' : '0';
      $('mPos').textContent = fmtTime(pos / 1000); $('mDur').textContent = fmtTime(dur / 1000);
    }
    setPlayIcon(!!m.playing); card.classList.toggle('playing', !!m.playing);
    setArt(m.art || null);
  }
  var lastArt = null;
  function setArt(src) {
    if (src === lastArt) return; lastArt = src;
    var img = $('mArtImg');
    if (src) { img.src = src; $('mArt').classList.add('has'); img.onerror = function () { $('mArt').classList.remove('has'); }; }
    else { img.removeAttribute('src'); $('mArt').classList.remove('has'); }
  }
  function setPlayIcon(p) { $('mPlay').innerHTML = icon(p ? 'pause' : 'play'); }
  function radioMedia() {
    var s = st.radio.station; if (!s) return null;
    return { source: 'Live radio', title: s.name, artist: [s.country, s.tags].filter(Boolean).join(' · ').slice(0, 60), live: true, playing: st.radio.playing, art: s.favicon || null, bitrate: s.bitrate };
  }
  function mediaAction(act) {
    if (st.radio.playing || (st.radio.station && !(st.media && st.media.playing))) {
      if (act === 'toggle') return st.radio.playing ? radioStop() : radioPlay(st.radio.station);
      if (act === 'next' || act === 'prev') return radioStep(act === 'next' ? 1 : -1);
    }
    if (NATIVE && st.media) { call('media', act); return; }
    if (NATIVE) { call('media', act); return; }
    // browser demo
    demoMedia.playing = act === 'toggle' ? !demoMedia.playing : true;
    if (act !== 'toggle') { demoMedia.i = (demoMedia.i + (act === 'next' ? 1 : DEMO_SONGS.length - 1)) % DEMO_SONGS.length; demoMedia.pos = 0; }
    syncDemoMedia();
  }

  /* ───────────────────────── Radio ───────────────────────── */
  var RB = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
  var rbHost = 0, radioTab = 'local';
  var audio = $('radioAudio');
  function rb(path, cb) {
    getJSON(RB[rbHost] + path, function (err, data) {
      if (err && rbHost < RB.length - 1) { rbHost++; return rb(path, cb); }
      cb(err, data);
    });
  }
  function loadRadio(q) {
    var list = $('radioList');
    if (radioTab === 'fav' && !q) { st.radio.list = S.favs.slice(); renderRadio(); return; }
    list.innerHTML = '<div class="empty">Loading stations…</div>';
    var p = '/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=60';
    if (q) p += '&name=' + encodeURIComponent(q);
    else if (radioTab === 'local') p += '&countrycode=LK';
    rb(p, function (err, data) {
      if (err || !data) { list.innerHTML = '<div class="empty">Couldn’t load stations. Check the internet connection.</div>'; return; }
      if (q && data.length < 5) { // try tag search too
        rb('/json/stations/search?hidebroken=true&order=clickcount&reverse=true&limit=40&tag=' + encodeURIComponent(q), function (e2, d2) {
          st.radio.list = data.concat(d2 || []).map(slim); renderRadio();
        });
        return;
      }
      st.radio.list = data.map(slim); renderRadio();
    });
  }
  function slim(s) { return { id: s.stationuuid || s.id, name: (s.name || '').trim(), url: s.url_resolved || s.url, favicon: s.favicon || '', country: s.country || '', tags: (s.tags || '').split(',').slice(0, 3).join(', '), bitrate: s.bitrate || 0, codec: s.codec || '' }; }
  function isFav(id) { return S.favs.some(function (f) { return f.id === id; }); }
  function renderRadio() {
    var list = $('radioList'), l = st.radio.list;
    if (!l.length) { list.innerHTML = '<div class="empty">' + (radioTab === 'fav' ? 'No favorites yet – tap ☆ on a station.' : 'No stations found.') + '</div>'; return; }
    list.innerHTML = l.map(function (s, i) {
      var on = st.radio.station && st.radio.station.id === s.id;
      return '<div class="item' + (on ? ' on' : '') + '" data-i="' + i + '">' +
        (s.favicon ? '<img src="' + esc(s.favicon) + '" alt="" onerror="this.outerHTML=\'<div class=ph>' + icon('radio').replace(/"/g, '&quot;') + '</div>\'">' : '<div class="ph">' + icon('radio') + '</div>') +
        '<div class="t"><b>' + esc(s.name) + '</b><span>' + esc([s.tags, s.bitrate ? s.bitrate + ' kbps' : ''].filter(Boolean).join(' · ') || s.country) + '</span></div>' +
        '<button class="fav' + (isFav(s.id) ? ' on' : '') + '" data-fav="' + i + '">' + icon(isFav(s.id) ? 'starf' : 'star') + '</button></div>';
    }).join('');
  }
  function radioPlay(s) {
    if (!s) return;
    st.radio.station = s; st.radio.idx = st.radio.list.indexOf(s);
    S.lastStation = s; save();
    audio.src = s.url; st.radio.playing = true;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { st.radio.playing = false; toast('Station failed to play'); renderMedia(); });
    if (NATIVE && st.media && st.media.playing) call('media', 'pause');
    renderMedia(); renderRadio();
  }
  function radioStop() { audio.pause(); st.radio.playing = false; renderMedia(); }
  function radioStep(d) {
    var l = st.radio.list.length ? st.radio.list : S.favs;
    if (!l.length) return;
    var i = l.findIndex ? l.findIndex(function (x) { return st.radio.station && x.id === st.radio.station.id; }) : -1;
    radioPlay(l[(i + d + l.length) % l.length]);
  }
  audio.addEventListener('error', function () { if (st.radio.playing) { st.radio.playing = false; toast('Stream unavailable – try another station'); renderMedia(); } });
  audio.addEventListener('playing', function () { st.radio.playing = true; renderMedia(); });

  /* ───────────────────────── Weather ───────────────────────── */
  function wxKind(c) {
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'cloud';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'storm';
    return 'cloud';
  }
  var WX_TXT = { clear: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Foggy', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm' };
  var wxLoc = null;
  function loadWeather(force) {
    var loc = (S.gpsWeather && st.gpsLoc) ? st.gpsLoc : S.city;
    if (!force && st.wx && Date.now() - st.wx.at < 20 * 60000 && wxLoc && Math.abs(wxLoc.lat - loc.lat) < 0.2 && Math.abs(wxLoc.lon - loc.lon) < 0.2) return;
    wxLoc = loc;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat.toFixed(3) + '&longitude=' + loc.lon.toFixed(3) +
      '&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=4';
    getJSON(url, function (err, d) {
      if (err || !d || !d.current) { if (!st.wx) $('wDesc').textContent = 'Weather unavailable offline'; return; }
      var name = loc.name;
      st.wx = { at: Date.now(), d: d, name: name };
      try { localStorage.setItem('cl.wx', JSON.stringify(st.wx)); } catch (e) { }
      renderWeather();
      if (loc === st.gpsLoc && !st.gpsLoc.name) reverseGeocode(loc);
    });
  }
  function reverseGeocode(loc) {
    getJSON('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + loc.lat + '&longitude=' + loc.lon + '&localityLanguage=en', function (e, r) {
      if (!e && r) { loc.name = r.city || r.locality || r.principalSubdivision || 'Current location'; if (st.wx) { st.wx.name = loc.name; renderWeather(); } }
    });
  }
  function renderWeather() {
    var w = st.wx; if (!w) return;
    var d = w.d, c = d.current, dl = d.daily;
    var kind = wxKind(c.weather_code), day = c.is_day !== 0;
    $('wIcon').innerHTML = weatherIcon(kind, day);
    $('wCity').textContent = w.name || 'Current location';
    $('wNow').textContent = Math.round(c.temperature_2m) + '°';
    $('wHL').textContent = Math.round(dl.temperature_2m_max[0]) + '° / ' + Math.round(dl.temperature_2m_min[0]) + '°';
    var ss = dl.sunset && dl.sunset[0] ? dl.sunset[0].slice(11, 16) : '';
    $('wDesc').textContent = WX_TXT[kind] + ' · ' + Math.round(c.relative_humidity_2m) + '% · ' + Math.round(c.wind_speed_10m) + ' km/h' + (ss ? ' · Sunset ' + ss : '');
    var html = '';
    for (var i = 1; i < Math.min(4, dl.time.length); i++) {
      var dt = new Date(dl.time[i] + 'T12:00:00');
      html += '<div>' + DAYS[dt.getDay()].slice(0, 3) + weatherIcon(wxKind(dl.weather_code[i]), true) + '<b>' + Math.round(dl.temperature_2m_max[i]) + '°</b> ' + Math.round(dl.temperature_2m_min[i]) + '°</div>';
    }
    $('wDays').innerHTML = html;
    // sunrise/sunset (local to the device clock) drive the auto theme
    if (dl.sunrise && dl.sunset) {
      var today = new Date();
      var toMs = function (s) { var p = s.slice(11, 16).split(':'); var t = new Date(today); t.setHours(+p[0], +p[1], 0, 0); return t.getTime(); };
      st.sun = { rise: toMs(dl.sunrise[0]), set: toMs(dl.sunset[0]) };
      applyTheme();
    }
  }

  /* ───────────────────────── Vehicle / OBD ───────────────────────── */
  function setV(id, val, fmt, warn, bad) {
    var el = $(id), item = el.closest('.v-item');
    el.textContent = val == null ? '--' : fmt(val);
    item.classList.toggle('bad', !!bad); item.classList.toggle('warn', !!warn && !bad);
  }
  function renderVehicle() {
    var o = st.obd;
    setV('vCool', o.cool, function (v) { return Math.round(v); }, o.cool > 100, o.cool > 106);
    setV('vVolt', o.volt, function (v) { return v.toFixed(1); }, o.volt != null && o.volt < 12.2, o.volt != null && (o.volt < 11.6 || o.volt > 15.2));
    setV('vFuel', o.fuel, function (v) { return Math.round(v); }, o.fuel != null && o.fuel < 15, o.fuel != null && o.fuel < 7);
    setV('vLoad', o.load, function (v) { return Math.round(v); });
    var tag = $('obdTag'), state = o.state;
    tag.textContent = state === 'connected' ? (S.demo && !NATIVE ? 'Demo' : 'OBD live') : state === 'connecting' ? 'Connecting…' : state === 'error' ? 'OBD error' : 'OBD off';
    tag.className = 'tag' + (state === 'connected' ? ' on' : state === 'error' ? ' bad' : '');
    $('chipObd').className = 'chip' + (state === 'connected' ? ' on' : state === 'connecting' ? ' warn' : '');
    $('obdState').textContent = tag.textContent;
    $('obdConnect').textContent = state === 'connected' || state === 'connecting' ? 'Disconnect' : 'Connect';
    var h = $('vHealth');
    if (st.dtcs == null) { h.className = 'v-health idle'; $('vHealthTxt').textContent = state === 'connected' ? 'Scan pending…' : 'Connect OBD to scan'; }
    else if (!st.dtcs.length) { h.className = 'v-health ok'; $('vHealthTxt').textContent = 'No issues found'; }
    else { h.className = 'v-health bad'; $('vHealthTxt').textContent = st.dtcs.length + ' trouble code' + (st.dtcs.length > 1 ? 's' : '') + ' · ' + st.dtcs[0]; }
    h.querySelector('i').innerHTML = icon(st.dtcs && st.dtcs.length ? 'alert' : 'check');
    renderObdTiles();
  }
  function renderObdTiles() {
    if (!$('sheet-obd').classList.contains('on')) return;
    var o = st.obd, f = function (v, d) { return v == null ? '--' : v.toFixed(d || 0); };
    var tiles = [[f(st.speed), 'Speed km/h'], [f(st.rpm), 'Engine rpm'], [f(o.cool), 'Coolant °C'], [f(o.volt, 1), 'Battery V'],
      [f(o.thr), 'Throttle %'], [f(o.load), 'Engine load %'], [f(o.iat), 'Intake air °C'], [f(o.fuel), 'Fuel level %']];
    $('obdTiles').innerHTML = tiles.map(function (t) { return '<div class="tile"><b>' + t[0] + '</b><span>' + t[1] + '</span></div>'; }).join('');
  }
  function renderDtcs() {
    var l = $('dtcList');
    if (st.dtcs == null) { l.innerHTML = '<div class="empty">' + (st.obd.state === 'connected' ? 'Tap “Scan now” to read trouble codes.' : 'Connect an adapter and tap “Scan now”.') + '</div>'; return; }
    if (!st.dtcs.length) { l.innerHTML = '<div class="empty">' + icon('check') + ' No stored trouble codes. Your Cruze looks healthy.</div>'; return; }
    l.innerHTML = st.dtcs.map(function (c) { return '<div class="item dtc"><span class="code">' + esc(c) + '</span><div class="t"><b>' + esc(describeDtc(c)) + '</b><span>Stored fault code</span></div></div>'; }).join('');
  }
  var alerted = {};
  function alertOnce(key, msg, warn) {
    if (alerted[key] && Date.now() - alerted[key] < 10 * 60000) return;
    alerted[key] = Date.now();
    var b = $('alertBanner'); $('alertTxt').textContent = msg; b.classList.toggle('warn', !!warn); b.classList.add('on');
    beep();
    clearTimeout(b._t); b._t = setTimeout(function () { b.classList.remove('on'); }, 12000);
  }
  function checkVehicleAlerts() {
    var o = st.obd;
    if (o.cool > 106) alertOnce('cool', 'Engine overheating – coolant ' + Math.round(o.cool) + '°C. Pull over safely.');
    if (o.volt != null && o.volt < 11.6 && st.rpm > 500) alertOnce('volt', 'Charging problem – battery at ' + o.volt.toFixed(1) + ' V with engine running.', true);
    if (o.fuel != null && o.fuel < 10) alertOnce('fuel', 'Low fuel – ' + Math.round(o.fuel) + '% left.', true);
  }
  function refreshDevices() {
    var sel = $('obdDev');
    var devs = [];
    try { devs = JSON.parse(call('obdDevices') || '[]'); } catch (e) { }
    if (!NATIVE) devs = [{ name: 'OBDII (demo)', addr: 'DEMO' }];
    sel.innerHTML = '<option value="">' + (devs.length ? 'Select paired ELM327 adapter…' : 'No paired adapters – pair “OBDII” in Bluetooth settings') + '</option>' +
      devs.map(function (d) { return '<option value="' + esc(d.addr) + '"' + (d.addr === S.obdAddr ? ' selected' : '') + '>' + esc(d.name || d.addr) + ' · ' + esc(d.addr) + '</option>'; }).join('');
  }

  /* ───────────────────────── Sheets ───────────────────────── */
  var openSheet = null;
  function show(id) {
    if (openSheet) hide(true);
    openSheet = $('sheet-' + id);
    openSheet.classList.add('on'); $('scrim').classList.add('on');
    qa('.dock button').forEach(function (b) { b.classList.toggle('active', b.dataset.act === id); });
    if (id === 'radio') { if (!st.radio.list.length) loadRadio(); else renderRadio(); }
    if (id === 'apps') loadApps();
    if (id === 'obd') { refreshDevices(); renderObdTiles(); renderDtcs(); }
    if (id === 'settings') renderSettings();
    if (id === 'quick') { var v = call('getVolume'); if (v != null) $('qVol').value = v; }
    if (id === 'connect') $('connInfo').textContent = navigator.onLine ? 'Internet: connected' : 'Internet: offline';
  }
  function hide(silent) {
    if (!openSheet) return false;
    openSheet.classList.remove('on'); openSheet = null;
    if (!silent) $('scrim').classList.remove('on');
    qa('.dock button').forEach(function (b) { b.classList.remove('active'); });
    $('dock').querySelector('[data-act="nav"]').classList.add('active');
    return true;
  }

  /* ───────────────────────── Apps ───────────────────────── */
  var apps = null;
  function loadApps() {
    if (apps) return renderApps();
    $('appsGrid').innerHTML = '<div class="empty">Loading apps…</div>';
    if (NATIVE) call('requestApps');
    else setTimeout(function () {
      CL.onApps([['Maps', 'com.google.android.apps.maps'], ['Waze', 'com.waze'], ['Spotify', 'com.spotify.music'], ['YouTube', 'com.google.android.youtube'], ['YT Music', 'com.google.android.apps.youtube.music'], ['Chrome', 'com.android.chrome'], ['Phone', 'com.android.dialer'], ['Settings', 'com.android.settings'], ['Torque', 'org.prowl.torque'], ['Files', 'com.android.documentsui']].map(function (a) { return { label: a[0], pkg: a[1], icon: '' }; }));
    }, 200);
  }
  function renderApps() {
    var q = ($('appSearch').value || '').toLowerCase();
    var list = (apps || []).filter(function (a) { return !q || a.label.toLowerCase().indexOf(q) >= 0; });
    $('appsGrid').innerHTML = list.length ? list.map(function (a) {
      return '<button class="app" data-pkg="' + esc(a.pkg) + '">' + (a.icon ? '<img src="data:image/png;base64,' + a.icon + '" alt="">' : '<div class="item"><div class="ph">' + icon('apps') + '</div></div>') + '<span>' + esc(a.label) + '</span></button>';
    }).join('') : '<div class="empty">No apps</div>';
  }

  /* ───────────────────────── Settings sheet ───────────────────────── */
  function segSet(id, val) { qa('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === val); }); }
  function renderSettings() {
    segSet('setTheme', S.theme); segSet('setLights', S.lightsMode); segSet('setPerf', S.perf); segSet('setUnits', S.units);
    $('set24').checked = S.clock24; $('setLimitOn').checked = S.limitOn; $('setLimit').value = S.limit; $('limitVal').textContent = S.limit + ' km/h';
    $('setService').value = S.serviceKm; $('setGpsWx').checked = S.gpsWeather; $('setDemo').checked = S.demo;
    if (NATIVE && !apps) call('requestApps');
    fillAppSelects();
    var v = call('getVersion'); if (v) $('ver').textContent = v;
  }
  function fillAppSelects() {
    [['setNavPkg', 'navPkg', 'Auto (Google Maps / Waze)'], ['setMusicPkg', 'musicPkg', 'Ask / system default'], ['setVideoPkg', 'videoPkg', 'Auto (YouTube)']].forEach(function (x) {
      var sel = $(x[0]), cur = S[x[1]];
      sel.innerHTML = '<option value="">' + x[2] + '</option>' + (apps || []).map(function (a) { return '<option value="' + esc(a.pkg) + '"' + (a.pkg === cur ? ' selected' : '') + '>' + esc(a.label) + '</option>'; }).join('');
    });
  }

  /* ───────────────────────── Actions ───────────────────────── */
  function act(a) {
    switch (a) {
      case 'nav': if (NATIVE) call('openApp', 'nav', S.navPkg); else toast('Opens Google Maps / Waze on the head unit'); break;
      case 'music': if (NATIVE) call('openApp', 'music', S.musicPkg); else toast('Opens your music app'); break;
      case 'video': if (NATIVE) call('openApp', 'video', S.videoPkg); else toast('Opens YouTube / video app'); break;
      case 'phone': if (NATIVE) call('openApp', 'phone', ''); else toast('Opens the dialer'); break;
      case 'radio': case 'apps': case 'settings': case 'obd': case 'connect': case 'quick': show(a); break;
    }
  }

  /* ───────────────────────── Demo (browser preview / test drive) ───────────────────────── */
  var DEMO_SONGS = [['Highway Nights', 'Colombo Drive FM', 222], ['Monsoon Road', 'Lanka Lo-Fi', 198], ['Galle Face Sunset', 'Coastal Beats', 241]];
  var demoMedia = { i: 0, pos: 64, playing: true };
  function syncDemoMedia() {
    var s = DEMO_SONGS[demoMedia.i];
    st.media = { source: 'Now playing · Demo', title: s[0], artist: s[1], pos: demoMedia.pos * 1000, dur: s[2] * 1000, playing: demoMedia.playing };
    renderMedia();
  }
  var demoT = 0;
  function demoTick() {
    if (!S.demo) return;
    demoT += 1;
    var base = 48 + Math.sin(demoT / 9) * 30 + Math.sin(demoT / 3.3) * 6;
    var spd = Math.max(0, base);
    if (demoT % 40 > 34) spd = Math.max(0, spd - (demoT % 40 - 34) * 9); // a braking moment
    setSpeed(spd, 'DEMO');
    st.obdAt = 0;
    st.rpm = spd < 2 ? 800 : 1200 + (spd % 40) * 70;
    renderRpm(st.rpm);
    st.heading = (st.heading == null ? 40 : st.heading + Math.sin(demoT / 7) * 4);
    st.obd.state = 'connected';
    st.obd.cool = 88 + Math.sin(demoT / 20) * 2; st.obd.volt = 13.9 + Math.sin(demoT / 6) * 0.2; st.obd.fuel = 62 - demoT * 0.01;
    st.obd.load = 25 + spd / 3; st.obd.thr = 12 + spd / 5; st.obd.iat = 34;
    if (st.dtcs == null && demoT > 3) st.dtcs = [];
    renderVehicle();
    if (!NATIVE && demoMedia.playing) { demoMedia.pos = (demoMedia.pos + 1) % DEMO_SONGS[demoMedia.i][2]; if (!st.radio.playing && !st.radio.station) syncDemoMedia(); }
    $('chipGps').classList.add('on');
  }

  /* ───────────────────────── Native → JS ───────────────────────── */
  window.CL = {
    onLocation: function (o) {
      st.gpsAt = Date.now();
      $('chipGps').classList.add('on');
      if (!S.demo && o.live !== false) setSpeed((o.speed || 0) * 3.6, 'GPS');
      if (o.bearing != null && o.speed > 1.5) st.heading = o.bearing;
      if (o.lat != null) {
        var first = !st.gpsLoc;
        st.gpsLoc = st.gpsLoc && Math.abs(st.gpsLoc.lat - o.lat) < 0.05 && Math.abs(st.gpsLoc.lon - o.lon) < 0.05 ? st.gpsLoc : { lat: o.lat, lon: o.lon, name: '' };
        if (first && S.gpsWeather) loadWeather(true);
      }
    },
    onObd: function (d) {
      if (S.demo) return;
      st.obdAt = Date.now();
      if (d.speed != null) setSpeed(d.speed, 'OBD');
      if (d.rpm != null) { st.rpm = d.rpm; renderRpm(d.rpm); }
      ['cool', 'volt', 'fuel', 'load', 'thr', 'iat'].forEach(function (k) { if (d[k] != null) st.obd[k] = d[k]; });
      renderVehicle(); checkVehicleAlerts();
    },
    onObdStatus: function (state, msg) {
      st.obd.state = state;
      if (state !== 'connected') { st.rpm = 0; renderRpm(0); }
      if (msg) toast(msg);
      if (state === 'connected') setTimeout(function () { call('obdScan'); }, 2500);
      renderVehicle(); renderDtcs();
    },
    onDtc: function (codes, msg) {
      st.dtcs = codes || [];
      renderVehicle(); renderDtcs();
      if (msg) toast(msg);
      if (st.dtcs.length) alertOnce('dtc:' + st.dtcs.join(','), 'Check engine: ' + st.dtcs.length + ' trouble code' + (st.dtcs.length > 1 ? 's' : '') + ' – ' + st.dtcs[0] + ' ' + describeDtc(st.dtcs[0]), true);
    },
    onMedia: function (m) {
      st.media = m && m.title ? m : null;
      if (st.media && st.media.playing && st.radio.playing) radioStop();
      renderMedia();
    },
    onLight: function (lux) { st.lux = lux; applyTheme(); },
    onNightMode: function (night) { st.nightSys = night; applyTheme(); },
    onApps: function (list) { apps = list || []; apps.sort(function (a, b) { return a.label.localeCompare(b.label); }); if (openSheet && openSheet.id === 'sheet-apps') renderApps(); fillAppSelects(); },
    onNet: function (online) { $('chipNet').classList.toggle('on', !!online); if (online) loadWeather(); },
    onToast: function (m) { toast(m); },
    back: function () { if (!hide()) { /* already home */ } }
  };

  /* ───────────────────────── Wire up UI ───────────────────────── */
  function bind() {
    hydrateIcons();
    // swatches
    $('swatches').innerHTML = Object.keys(COLORS).map(function (k) { return '<button class="swatch" data-c="' + k + '" style="background:' + COLORS[k].body + '"><span>' + COLORS[k].name.split(' ').pop() + '</span></button>'; }).join('');
    $('swatches').addEventListener('click', function (e) { var b = e.target.closest('.swatch'); if (b) { S.color = b.dataset.c; save(); applyColor(); } });

    $('dock').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) act(b.dataset.act); });
    $('scrim').addEventListener('click', function () { hide(); });
    qa('[data-close]').forEach(function (b) { b.addEventListener('click', function () { hide(); }); });
    $('btnQuick').addEventListener('click', function () { show('quick'); });
    $('btnVoice').addEventListener('click', function () { if (NATIVE) call('openApp', 'assistant', ''); else toast('Opens Google Assistant'); });
    $('btnTheme').addEventListener('click', function () { S.theme = { auto: 'day', day: 'night', night: 'auto' }[S.theme]; save(); applyTheme(); toast('Theme: ' + (S.theme === 'auto' ? 'Auto (follows headlights / sunset)' : S.theme === 'day' ? 'Light' : 'Dark')); });
    $('carHint').addEventListener('click', function () { show('settings'); });
    $('carStage').addEventListener('click', function (e) { if (!e.target.closest('button')) show('obd'); });
    $('vehicleCard').addEventListener('click', function () { show('obd'); });
    $('weatherCard').addEventListener('click', function () { loadWeather(true); toast('Refreshing weather…'); });
    $('speedCard').addEventListener('click', function () { show('obd'); });

    // media
    $('mPlay').addEventListener('click', function () { mediaAction('toggle'); });
    $('mNext').addEventListener('click', function () { mediaAction('next'); });
    $('mPrev').addEventListener('click', function () { mediaAction('prev'); });
    $('mArt').addEventListener('click', function () { if (st.radio.station) show('radio'); else act('music'); });

    // radio
    $('radioTabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; radioTab = b.dataset.tab; qa('#radioTabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('radioSearch').value = ''; loadRadio(); });
    var rsT; $('radioSearch').addEventListener('input', function () { clearTimeout(rsT); var q = this.value.trim(); rsT = setTimeout(function () { loadRadio(q); }, 450); });
    $('radioList').addEventListener('click', function (e) {
      var f = e.target.closest('[data-fav]');
      if (f) { var s = st.radio.list[+f.dataset.fav]; if (isFav(s.id)) S.favs = S.favs.filter(function (x) { return x.id !== s.id; }); else S.favs.push(s); save(); renderRadio(); return; }
      var it = e.target.closest('.item'); if (!it) return;
      var st2 = st.radio.list[+it.dataset.i];
      if (st.radio.station && st.radio.station.id === st2.id && st.radio.playing) radioStop(); else radioPlay(st2);
    });

    // apps
    $('appSearch').addEventListener('input', renderApps);
    $('appsGrid').addEventListener('click', function (e) { var b = e.target.closest('.app'); if (b) { if (NATIVE) call('launch', b.dataset.pkg); else toast('Launch ' + b.dataset.pkg); hide(); } });

    // obd
    $('obdRefresh').addEventListener('click', refreshDevices);
    $('obdConnect').addEventListener('click', function () {
      if (st.obd.state === 'connected' || st.obd.state === 'connecting') { call('obdDisconnect'); if (!NATIVE) { S.demo = false; save(); CL.onObdStatus('off', 'Disconnected'); } return; }
      var a = $('obdDev').value; if (!a) { toast('Pick your OBD adapter first'); return; }
      S.obdAddr = a; save();
      if (NATIVE) call('obdConnect', a); else { S.demo = true; save(); CL.onObdStatus('connected', 'Demo adapter connected'); }
    });
    $('dtcScan').addEventListener('click', function () {
      if (st.obd.state !== 'connected') { toast('Connect the OBD adapter first'); return; }
      $('dtcList').innerHTML = '<div class="empty">Scanning ECU…</div>';
      if (NATIVE) call('obdScan'); else setTimeout(function () { CL.onDtc([], 'Scan complete'); }, 1200);
    });
    $('dtcClear').addEventListener('click', function () {
      if (st.obd.state !== 'connected') { toast('Connect the OBD adapter first'); return; }
      if (!confirm('Clear all trouble codes and turn off the check-engine light?\nOnly do this after the fault has been fixed.')) return;
      if (NATIVE) call('obdClear'); else CL.onDtc([], 'Codes cleared');
    });

    // settings
    function seg(id, key, after) { $(id).addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S[key] = b.dataset.v; save(); segSet(id, S[key]); if (after) after(); }); }
    seg('setTheme', 'theme', applyTheme);
    seg('setLights', 'lightsMode', function () { st.manualLights = null; applyTheme(); });
    seg('setPerf', 'perf', applyPerf);
    seg('setUnits', 'units', function () { lastOn = -1; buildGauge(); renderGauge(st.shown); renderStats(); });
    $('set24').addEventListener('change', function () { S.clock24 = this.checked; save(); lastMin = -1; tickClock(); });
    $('setLimitOn').addEventListener('change', function () { S.limitOn = this.checked; save(); buildGauge(); lastOn = -1; renderGauge(st.shown); });
    $('setLimit').addEventListener('input', function () { S.limit = +this.value; $('limitVal').textContent = S.limit + ' km/h'; save(); buildGauge(); lastOn = -1; renderGauge(st.shown); });
    $('setService').addEventListener('change', function () { S.serviceKm = Math.max(500, +this.value || 5000); save(); renderStats(); });
    $('btnServiceReset').addEventListener('click', function () { S.serviceStart = S.odo; save(); renderStats(); toast('Service counter reset'); });
    $('btnTripReset').addEventListener('click', function () { st.tripKm = 0; st.movingMs = 0; st.maxSpeed = 0; st.startedAt = Date.now(); renderStats(); toast('Trip reset'); });
    $('setDemo').addEventListener('change', function () { S.demo = this.checked; save(); if (!S.demo) { setSpeed(0, 'GPS'); st.obd.state = 'off'; renderVehicle(); } });
    $('setGpsWx').addEventListener('change', function () { S.gpsWeather = this.checked; save(); loadWeather(true); });
    var csT; $('citySearch').addEventListener('input', function () {
      clearTimeout(csT); var q = this.value.trim(); if (q.length < 2) { $('cityList').innerHTML = ''; return; }
      csT = setTimeout(function () {
        getJSON('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=' + encodeURIComponent(q), function (e, r) {
          var res = (r && r.results) || [];
          $('cityList').innerHTML = res.length ? res.map(function (c, i) { return '<button class="item" data-i="' + i + '"><div class="t"><b>' + esc(c.name) + '</b><span>' + esc([c.admin1, c.country].filter(Boolean).join(', ')) + '</span></div></button>'; }).join('') : '<div class="empty">No match</div>';
          $('cityList')._res = res;
        });
      }, 400);
    });
    $('cityList').addEventListener('click', function (e) {
      var b = e.target.closest('.item'); if (!b) return; var c = this._res[+b.dataset.i];
      S.city = { name: c.name, lat: c.latitude, lon: c.longitude }; S.gpsWeather = false; save();
      $('setGpsWx').checked = false; $('cityList').innerHTML = ''; $('citySearch').value = '';
      loadWeather(true); toast('Weather location: ' + c.name);
    });
    qa('#sheet-settings select').forEach(function (sel) { sel.addEventListener('change', function () { S[sel.dataset.kind + 'Pkg'] = sel.value; save(); }); });
    qa('[data-sys]').forEach(function (b) { b.addEventListener('click', function () { if (NATIVE) call('openApp', b.dataset.sys, ''); else toast('Android only'); }); });

    // quick
    $('qVol').addEventListener('input', function () { call('setVolume', +this.value); });
    $('qBright').addEventListener('input', function () { var v = +this.value / 100; if (NATIVE) call('setBrightness', v); else document.body.style.filter = 'brightness(' + (0.4 + v * 0.6) + ')'; });
    qa('.q-tiles button').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = b.dataset.q;
        if (q === 'lights') { st.manualLights = st.manualLights == null ? !st.lights : (st.manualLights ? false : null); applyTheme(); return; }
        if (q === 'obd') { show('obd'); return; }
        if (NATIVE) call('openApp', q, ''); else toast('Opens ' + q + ' settings');
      });
    });

    $('alertClose').addEventListener('click', function () { $('alertBanner').classList.remove('on'); });
    window.addEventListener('online', function () { CL.onNet(true); });
    window.addEventListener('offline', function () { CL.onNet(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  }

  /* ───────────────────────── Boot ───────────────────────── */
  function boot() {
    try { st.info = JSON.parse(call('getInfo') || '{}'); } catch (e) { st.info = {}; }
    if (st.info.night != null) st.nightSys = null; // only trust night mode once native reports a change
    bind();
    applyColor(); applyPerf(); buildGauge(); renderGauge(0); renderRpm(0);
    try { var c = JSON.parse(localStorage.getItem('cl.wx')); if (c) { st.wx = c; renderWeather(); } } catch (e) { }
    tickClock(); renderStats(); renderVehicle(); renderMedia();
    $('chipNet').classList.toggle('on', navigator.onLine);
    $('dock').querySelector('[data-act="nav"]').classList.add('active');
    if (S.lastStation) { st.radio.station = null; }
    loadWeather();
    setInterval(tickClock, 1000);
    setInterval(function () { renderStats(); save(); }, 5000);
    setInterval(demoTick, 1000);
    setInterval(function () { loadWeather(); }, 10 * 60000);
    setInterval(function () { if (Date.now() - st.gpsAt > 8000 && !S.demo) $('chipGps').classList.remove('on'); }, 4000);
    if (!NATIVE) syncDemoMedia();
    requestAnimationFrame(frame);
    call('ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
