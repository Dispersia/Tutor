/* ==========================================================================
   Tutor — interaction
   The icon sprite, live rig ticker, sheets, talents, the deck builder and
   the drill. No dependencies; everything runs from the filesystem.
   ========================================================================== */
;(function () {
  'use strict'

  /* --- 1. The icon sprite ------------------------------------------------
     One set of single-stroke 24x24 glyphs, stroke-width 1.7, round caps.
     Injected before the body parses so <use> always resolves. */

  var ICONS = {
    home: 'M3 11.4 12 4l9 7.4M5.6 9.9V20h12.8V9.9M10 20v-5h4v5',
    skills:
      'M14.6 3.6 20.4 9.4l-2.5 2.5-5.8-5.8zM11.6 6.6 4 14.2l3 3 7.6-7.6M13 15l-2 2M15 17l-2 2',
    learn:
      'M4 5.6A2.6 2.6 0 0 1 6.6 3H12v18H6.6A2.6 2.6 0 0 0 4 18.4zM12 3h5.4A2.6 2.6 0 0 1 20 5.6v12.8a2.6 2.6 0 0 0-2.6-2.6H12',
    chat: 'M4 5h16v11H9.4L4 20z',
    bank: 'M4 8.4h16V20H4zM4 8.4 6.4 4h11.2L20 8.4M9.6 12.6h4.8',
    history: 'M12 3a9 9 0 1 1-8.2 5.4M3.4 3.6v4.8h4.8M12 7.4V12l3.2 2',
    settings:
      'M4 7.5h5M15 7.5h5M4 16.5h5M15 16.5h5M11.5 5.6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8.5 14.6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    plus: 'M12 5.5v13M5.5 12h13',
    chevron: 'M9.5 6 15.5 12l-6 6',
    chevronDown: 'M6 9.5 12 15.5l6-6',
    clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 7.8v4.6l3 1.8',
    spark: 'M12 3.2 13.7 9 19.5 10.7 13.7 12.4 12 18.2 10.3 12.4 4.5 10.7 10.3 9z',
    check: 'M5 12.8 9.4 17.2 19 6.6',
    x: 'M6 6l12 12M18 6 6 18',
    lock: 'M6.6 11h10.8v9H6.6zM9.2 11V8.2a2.8 2.8 0 0 1 5.6 0V11',
    alert: 'M12 4.2 20.4 19H3.6zM12 10v3.4M12 16.3h.01',
    retry: 'M19.8 12a7.8 7.8 0 1 1-2.4-5.6M19.8 4.2v4.4h-4.4',
    search: 'M10.6 4.2a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8zM15.4 15.4 20 20',
    edit: 'M4 20l3.6-.9L19.5 7.2 16.8 4.5 4.9 16.4zM15.6 5.7 18.3 8.4',
    trash: 'M5 7h14M9.4 7V4.8h5.2V7M7.2 7l1 12.2h7.6L16.8 7',
    deck: 'M8 3.4h9a2 2 0 0 1 2 2V17M5 6.4h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    arrowRight: 'M4.5 12h13M12.6 7.1 17.5 12l-4.9 4.9',
    play: 'M8 5.2 18.4 12 8 18.8z',
    eye: 'M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12zM12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
    target:
      'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2z',
    coin: 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zM12 7.6v8.8M14.4 9.4c-.4-.9-1.3-1.4-2.4-1.4-1.3 0-2.2.8-2.2 1.8s.9 1.5 2.2 1.8c1.3.3 2.5.8 2.5 1.9s-1 1.8-2.5 1.8c-1.2 0-2.1-.5-2.6-1.5',
    calendar: 'M4 6.4h16V20H4zM4 10.4h16M8.2 3.4v4M15.8 3.4v4',
    flame:
      'M12 3.2c3 4.1 5 6.2 5 9.2a5 5 0 0 1-10 0c0-1.6.7-2.9 1.8-4.2.4 1.2 1.2 2 2.2 2.4C11 8.7 11.4 5.9 12 3.2z',
    heart: 'M12 20S4 14.8 4 9.7A4.1 4.1 0 0 1 12 7.2 4.1 4.1 0 0 1 20 9.7C20 14.8 12 20 12 20z',
    shield: 'M12 3.4 20 6.4v6.2c0 4.8-3.8 7.6-8 8.6-4.2-1-8-3.8-8-8.6V6.4z',
    sword: 'M19.4 4.6h-5.2l-7 7 5.2 5.2 7-7zM7.2 11.6 4.7 14.1l5.2 5.2 2.5-2.5M4 20.2l2.6-2.6',
    fist: 'M6.4 12.4V8.6a1.6 1.6 0 0 1 3.2 0v2.6m0-3.8a1.6 1.6 0 0 1 3.2 0v3.8m0-3a1.6 1.6 0 0 1 3.2 0v3m0-1.6a1.6 1.6 0 0 1 3.2 0v3.6c0 4-2.8 6.6-6.4 6.6s-6.4-2.6-6.4-6.6v-3.4',
    bow: 'M6 4.2a12 12 0 0 1 0 15.6M6 4.2 18.6 19.8M17 6.6l2.4-2.4-2.4-2.4',
    staff: 'M12 3.2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM12 8.4 10 20.8h4z',
    prayer: 'M12 3.6v16.8M7.2 8.4h9.6M6 14.4a6 6 0 0 0 12 0',
    skull:
      'M12 3.4a7 7 0 0 0-7 7c0 2.2 1.1 3.4 1.8 4.2v2.4h10.4v-2.4c.7-.8 1.8-2 1.8-4.2a7 7 0 0 0-7-7zM9.6 10.6h.01M14.4 10.6h.01M10.4 17.4v1.6M13.6 17.4v1.6',
    pickaxe: 'M12 4.4v15.2M4.6 8.2c4.6-3.6 10.2-3.6 14.8 0M4.6 8.2l2.4 2.4M19.4 8.2l-2.4 2.4',
    axe: 'M13.4 4.6 20 11.2M13.4 4.6c-3.2.4-5.4 2.2-6.4 4.6l4.4 4.4c2.4-1 4.2-3.2 4.6-6.4zM9.2 11.2 4 20l3.4-2.6',
    fish: 'M3.4 12c3-4.6 8.6-6 12-3.2 1.4 1.2 2.2 2.6 2.6 3.2-.4.6-1.2 2-2.6 3.2-3.4 2.8-9 1.4-12-3.2zM12.6 12h.01M18 8.8l2.4-2.2v10.8L18 15.2',
    wheat:
      'M12 20.4V9.6M12 10.2c-2.4 0-4-1.6-4-4 2.4 0 4 1.6 4 4zm0 0c2.4 0 4-1.6 4-4-2.4 0-4 1.6-4 4zM12 15.4c-2.4 0-4-1.6-4-4 2.4 0 4 1.6 4 4zm0 0c2.4 0 4-1.6 4-4-2.4 0-4 1.6-4 4z',
    hammer: 'M14.4 3.6 20.4 9.6 17.6 12.4 11.6 6.4zM11 7 4 14l3 3 7-7M14.6 16.6 12.8 18.4',
    pot: 'M4.6 9.4h14.8v5.2a5.6 5.6 0 0 1-5.6 5.6h-3.6A5.6 5.6 0 0 1 4.6 14.6zM8.6 9.4c0-1.6 1.5-2.6 3.4-2.6s3.4 1 3.4 2.6M3 9.4h18',
    flask:
      'M10 3.6h4v4.2l3.6 7.4a2.4 2.4 0 0 1-2.2 3.4H8.6a2.4 2.4 0 0 1-2.2-3.4L10 7.8zM8.4 13.4h7.2',
    fletching: 'M5 19 19 5M14.6 5H19v4.4M5 19l1-3.4 2.4 2.4zM9.6 14.4l2.4 2.4',
    rune: 'M12 3.4 19 7.6v8.8L12 20.6 5 16.4V7.6zM12 8.4v7.2M9 10.4l6 3.2',
    gem: 'M12 3.8 20 9l-8 11.2L4 9zM4 9h16M12 3.8 8.6 9l3.4 11.2L15.4 9z',
    needle: 'M4.6 19.4 19.4 4.6M19.4 4.6h-4.8M19.4 4.6v4.8M8 16l-1.4 3.4L10 18',
    house: 'M4 11 12 4.4 20 11M6.4 9.6V20h11.2V9.6M10 20v-5.2h4V20',
    wand: 'M4.6 19.4 14 10M16.6 3.4v3.2M16.6 14.2v2.4M11.8 9.4h3.2M18.2 9.4h3.2M20.4 5.6l1.8-1.8M20.4 13.2l1.8 1.8M12.8 5.6 11 3.8',
    mask: 'M4.6 6.4h14.8v4.2c0 4.6-3.3 8-7.4 8s-7.4-3.4-7.4-8zM9 10.6h.01M15 10.6h.01M10 14.4c1.2 1 2.8 1 4 0',
    boot: 'M5.4 4.6h5v8.6l5.4 2.2a4 4 0 0 1 2.8 3.8v.4H5.4zM5.4 15.4h7.2',
    anvil: 'M4.4 8.4h15.2l-1.6 3-3.4 1.2v2.6h3l-1.6 4.4H8L6.4 15.2h3v-2.6L6 11.4z',
    gear: 'M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM12 3.6v2.2M12 18.2v2.2M3.6 12h2.2M18.2 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18',
    hand: 'M8.4 11V5.6a1.6 1.6 0 0 1 3.2 0V10m0-4.4a1.6 1.6 0 0 1 3.2 0V10m0-2.4a1.6 1.6 0 0 1 3.2 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-4a1.6 1.6 0 0 1 3.2 0',
  }

  function sprite() {
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">',
    ]
    Object.keys(ICONS).forEach(function (id) {
      parts.push(
        '<symbol id="i-' +
          id +
          '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' +
          ICONS[id] +
          '"/></symbol>',
      )
    })
    parts.push('</svg>')
    var holder = document.createElement('div')
    holder.innerHTML = parts.join('')
    document.documentElement.insertBefore(holder.firstChild, document.documentElement.firstChild)
  }

  sprite()

  /* --- 2. Helpers --------------------------------------------------------- */

  function fmtClock(ms) {
    if (ms <= 0) return 'still'
    var s = Math.floor(ms / 1000)
    var h = Math.floor(s / 3600)
    var m = Math.floor((s % 3600) / 60)
    var sec = s % 60
    if (h > 0) return h + 'h ' + m + 'm left'
    if (m > 0) return m + 'm left'
    return sec + 's left'
  }

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /* --- 3. Live rigs -------------------------------------------------------
     Each rig extrapolates between fetches: the counter climbs, the run bar
     drains, the clock counts down. The bank's copper pile runs off the same
     clock. */

  function startRigs() {
    var rigs = [].slice.call(document.querySelectorAll('[data-rig]'))
    var live = document.querySelector('[data-bank-live]')
    if (!rigs.length) return
    var state = rigs.map(function (rig) {
      return {
        rig: rig,
        base: Number(rig.dataset.rigCount || 0),
        rate: Number(rig.dataset.rigRate || 7) * 1000,
        run: Number(rig.dataset.rigRun || 0),
        total: Number(rig.dataset.rigTotal || 1),
        start: Date.now(),
        carry: 0,
      }
    })

    function tick() {
      var now = Date.now()
      state.forEach(function (s) {
        var elapsed = now - s.start
        var produced = Math.floor((elapsed + s.carry) / s.rate)
        s.carry = (elapsed + s.carry) % s.rate
        s.start = now
        s.base += produced
        s.run = Math.max(0, s.run - elapsed)

        var count = s.rig.querySelector('[data-rig-out]')
        if (count) count.textContent = s.base.toLocaleString('en-US')
        if (live && s.rig.dataset.rigCount === '312')
          live.textContent = s.base.toLocaleString('en-US')

        var bar = s.rig.querySelector('[data-rig-bar]')
        if (bar) bar.style.width = Math.max(0, (s.run / s.total) * 100) + '%'

        var clockEl = s.rig.querySelector('[data-rig-clock]')
        if (clockEl) clockEl.textContent = fmtClock(s.run)

        if (s.run <= 0) s.rig.classList.add('rig--still')
      })
    }
    tick()
    if (reduced()) return
    window.setInterval(tick, 1000)
  }

  /* --- 4. Sheets ---------------------------------------------------------- */

  function startSheets() {
    var lastFocus = null

    function focusables(root) {
      return [].slice
        .call(
          root.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
          ),
        )
        .filter(function (el) {
          return el.offsetParent !== null
        })
    }

    function close(sheet) {
      sheet.hidden = true
      var scrim = document.querySelector('[data-scrim="' + sheet.id + '"]')
      if (scrim) scrim.hidden = true
      document.querySelectorAll('[data-sheet-open="' + sheet.id + '"]').forEach(function (el) {
        el.setAttribute('aria-expanded', 'false')
      })
      document.body.style.overflow = ''
      if (lastFocus) lastFocus.focus()
    }

    function open(id, opener) {
      var sheet = document.getElementById(id)
      if (!sheet) return
      lastFocus = opener || document.activeElement
      sheet.hidden = false
      var scrim = document.querySelector('[data-scrim="' + id + '"]')
      if (scrim) scrim.hidden = false
      document.body.style.overflow = 'hidden'
      if (opener && opener.hasAttribute('data-sheet-open')) {
        opener.setAttribute('aria-expanded', 'true')
      }
      var section =
        opener && opener.dataset.sheetSection
          ? sheet.querySelector('#' + opener.dataset.sheetSection)
          : null
      if (section) {
        section.scrollIntoView({ block: 'nearest', behavior: 'auto' })
        section.focus()
        return
      }
      if (!sheet.hasAttribute('tabindex')) sheet.setAttribute('tabindex', '-1')
      sheet.focus()
    }

    document.addEventListener('click', function (event) {
      var opener = event.target.closest('[data-sheet-open]')
      if (opener) {
        event.preventDefault()
        open(opener.dataset.sheetOpen, opener)
        return
      }
      var closer = event.target.closest('[data-sheet-close]')
      if (closer) {
        event.preventDefault()
        var sheet = closer.closest('.sheet')
        if (sheet) close(sheet)
        return
      }
      if (event.target.matches('.scrim')) {
        var target = document.getElementById(event.target.dataset.scrim)
        if (target) close(target)
      }
    })

    document.addEventListener('keydown', function (event) {
      var sheet = document.querySelector('.sheet:not([hidden])')
      if (!sheet) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close(sheet)
        return
      }
      if (event.key !== 'Tab') return
      var items = focusables(sheet)
      if (!items.length) return
      var first = items[0]
      var last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    })
  }

  /* --- 5. Talents ---------------------------------------------------------
     A choice is recorded per profession and the ladder re-renders. */

  var TALENT_KEY = 'tutor.talents'

  function readTalents() {
    try {
      return JSON.parse(localStorage.getItem(TALENT_KEY) || '{}')
    } catch (err) {
      return {}
    }
  }

  function writeTalents(data) {
    try {
      localStorage.setItem(TALENT_KEY, JSON.stringify(data))
    } catch (err) {
      /* storage unavailable; the ladder still renders its default state */
    }
  }

  function startTalents() {
    var ladder = document.querySelector('[data-ladder]')
    if (!ladder) return
    var prof = ladder.dataset.ladder
    var respec = document.querySelector('[data-respec]')
    var live = document.querySelector('[data-talent-log]')

    function render() {
      var taken = readTalents()[prof] || {}
      ladder.querySelectorAll('[data-choice]').forEach(function (button) {
        var key = button.dataset.choice
        var isTaken = taken[key] === true
        button.setAttribute('aria-pressed', isTaken ? 'true' : 'false')
        button.classList.toggle('choice--taken', isTaken)
        var mark = button.querySelector('.choice__mark use')
        if (mark) mark.setAttribute('href', isTaken ? '#i-check' : '#i-plus')
      })
      if (live) {
        var picked = Object.keys(taken).filter(function (k) {
          return taken[k]
        })
        var bound = ladder.querySelectorAll('.node--done').length + picked.length
        var total = ladder.querySelectorAll('.node').length
        live.textContent = bound + ' of ' + total + ' bound'
      }
    }

    ladder.addEventListener('click', function (event) {
      var button = event.target.closest('[data-choice]')
      if (!button || button.classList.contains('choice--taken')) return
      var all = readTalents()
      var taken = all[prof] || {}
      taken[button.dataset.choice] = true
      all[prof] = taken
      writeTalents(all)
      render()
    })

    if (respec) {
      respec.addEventListener('click', function () {
        var all = readTalents()
        delete all[prof]
        writeTalents(all)
        render()
      })
    }

    render()
  }

  /* --- 6. Deck builder ---------------------------------------------------- */

  function startBuilder() {
    var form = document.querySelector('[data-builder]')
    if (!form) return
    var input = form.querySelector('textarea')
    var err = form.querySelector('[data-builder-err]')
    var errText = err ? err.querySelector('span') : null
    var list = document.querySelector('[data-decks]')
    var tpl = document.querySelector('#deck-template')

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var value = input.value.trim()
      if (value.length < 12) {
        if (err) err.hidden = false
        if (errText)
          errText.textContent =
            'Describe the deck in at least a dozen characters — a path, a topic, or the words you keep forgetting.'
        input.setAttribute('aria-invalid', 'true')
        input.focus()
        return
      }
      if (err) err.hidden = true
      input.removeAttribute('aria-invalid')
      if (!list || !tpl) return
      var node = tpl.content.firstElementChild.cloneNode(true)
      node.querySelector('[data-deck-name]').textContent = value.slice(0, 48)
      list.prepend(node)
      form.reset()
    })

    if (input) {
      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true') {
          input.removeAttribute('aria-invalid')
          if (err) err.hidden = true
        }
      })
    }
  }

  /* --- 7. Decks -----------------------------------------------------------
     A failed build retries in place: the banner goes, the skeleton returns. */

  function startDecks() {
    var retry = document.querySelector('[data-retry]')
    if (retry) {
      retry.addEventListener('click', function () {
        var deck = retry.closest('.deck')
        if (!deck) return
        deck.dataset.state = 'loading'
        deck.setAttribute('aria-busy', 'true')
        var banner = deck.querySelector('.banner')
        var row = deck.querySelector('.btn-row')
        var meta = deck.querySelector('.deck__meta')
        if (banner) banner.remove()
        if (row) row.remove()
        if (meta) meta.textContent = 'Generating the path from your description'
        var skeleton = document.createElement('div')
        skeleton.style.cssText = 'display:grid;gap:9px;margin-top:14px'
        skeleton.innerHTML =
          '<span class="skeleton" style="width:42%"></span><span class="skeleton" style="width:68%"></span><span class="skeleton" style="width:34%"></span>'
        deck.appendChild(skeleton)
        var note = document.createElement('p')
        note.className = 'faint'
        note.style.cssText = 'font-size:0.9rem;margin-top:12px'
        note.textContent = 'Retrying from the last saved card.'
        deck.appendChild(note)
      })
    }

    var editor = document.querySelector('[data-card-editor]')
    if (editor) {
      editor.addEventListener('submit', function (event) {
        event.preventDefault()
        var sheet = editor.closest('.sheet')
        var closer = sheet && sheet.querySelector('[data-sheet-close]')
        if (closer) closer.click()
      })
    }
  }

  /* --- 8. The drill ------------------------------------------------------- */

  function startDrill() {
    var form = document.querySelector('[data-drill]')
    if (!form) return
    var answer = form.querySelector('input')
    var result = document.querySelector('[data-result]')
    var verdict = document.querySelector('[data-verdict]')
    var expected = (form.dataset.answer || '').toLowerCase()

    function normalise(value) {
      return value
        .trim()
        .toLowerCase()
        .replace(/[.!?,;:"'’\s]+/g, '')
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      if (!answer.value.trim() || !result) return
      var ok = normalise(answer.value) === normalise(expected)
      result.hidden = false
      result.style.setProperty('--c', ok ? 'var(--jade)' : 'var(--crimson)')
      result.style.borderColor = ok
        ? 'color-mix(in oklab, var(--jade) 50%, var(--border))'
        : 'color-mix(in oklab, var(--crimson) 50%, var(--border))'
      result.style.background = ok
        ? 'color-mix(in oklab, var(--jade) 10%, var(--surface))'
        : 'color-mix(in oklab, var(--crimson) 10%, var(--surface))'
      if (verdict) {
        verdict.textContent = ok ? 'Correct' : 'Not quite'
        verdict.style.color = ok ? 'var(--jade)' : 'var(--crimson)'
      }
      var fsrs = result.querySelector('[data-fsrs]')
      if (fsrs) {
        fsrs.textContent = ok
          ? 'Good · next in 6 days · stability 38.9d'
          : 'Again · back in 10 minutes · stability 4.2d'
      }
      var rewards = result.querySelector('[data-rewards]')
      if (rewards) rewards.hidden = !ok
      var miss = result.querySelector('[data-miss]')
      if (miss) miss.hidden = ok
      var icon = result.querySelector('[data-result-icon] use')
      if (icon) {
        icon.setAttribute('href', ok ? '#i-check' : '#i-x')
        icon.style.color = ok ? 'var(--jade)' : 'var(--crimson)'
      }
      if (ok) {
        var rig = document.querySelector('[data-rig]')
        if (rig) {
          var run = Number(rig.dataset.rigRun || 0) + 8 * 60 * 1000
          var total = Number(rig.dataset.rigTotal || 1)
          rig.dataset.rigRun = run
          rig.dataset.rigTotal = Math.max(total, run)
          var shuttle = rig.querySelector('[data-rig-run]')
          if (shuttle) shuttle.textContent = fmtClock(run)
          var bar = rig.querySelector('[data-rig-bar]')
          if (bar) bar.style.width = '100%'
        }
      }
      result.scrollIntoView({
        block: 'nearest',
        behavior: reduced() ? 'auto' : 'smooth',
      })
    })
  }

  /* --- 9. Settings -------------------------------------------------------- */

  var MOTION_KEY = 'tutor.reducedMotion'

  function startSettings() {
    var toggle = document.querySelector('[data-motion-toggle]')
    if (!toggle) return
    var stored = null
    try {
      stored = localStorage.getItem(MOTION_KEY)
    } catch (err) {
      stored = null
    }
    var on = stored === 'true'
    toggle.checked = on
    document.documentElement.dataset.motion = on ? 'reduce' : 'full'
    toggle.addEventListener('change', function () {
      document.documentElement.dataset.motion = toggle.checked ? 'reduce' : 'full'
      try {
        localStorage.setItem(MOTION_KEY, String(toggle.checked))
      } catch (err) {
        /* the toggle still applies for this visit */
      }
    })
  }

  /* --- 10. Boot ----------------------------------------------------------- */

  function boot() {
    startRigs()
    startSheets()
    startTalents()
    startBuilder()
    startDecks()
    startDrill()
    startSettings()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
