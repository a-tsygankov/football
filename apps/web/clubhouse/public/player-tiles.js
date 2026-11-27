const get = id => document.getElementById(id)
const parts = [
  { key: 'frame', label: 'Card', options: { fade: 'Stripe gradient', tint: 'Card tint', rail: 'Side stripe', border: 'Outline', lifted: 'Shadow' } },
  { key: 'status', label: 'Availability', options: { photo: 'Tap photo', pill: 'Status pill', toggle: 'Mini toggle' } },
  { key: 'side', label: 'Side selector', options: { segments: 'Segments', cycle: 'Cycle button', select: 'Dropdown' } },
]
const url = new URL(location.href)
const preferred = { frame: 'fade', status: 'toggle', side: 'segments' }
const config = Object.fromEntries(parts.map(({ key, options }) => [key,
  Object.hasOwn(options, url.searchParams.get(key)) ? url.searchParams.get(key) : preferred[key]]))
const sides = ['Home', 'Reserve', 'Away']
const players = ['Alex', 'Robin', 'Sam', 'Jules', 'Drew', 'Casey'].map((name, id) => ({
  id, name, active: id !== 5, last: ['Home', 'Away'][id] || '', side: sides[[0, 2][id] ?? 1], photo: '/card-photos/sample-' + id + '.jpg',
}))
let tab = 0, expanded = false, editing = null, undo = null
const pending = new Map()
function element(tag, text, cls) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (cls) node.className = cls
  return node
}
function button(text, action, cls) {
  const node = element('button', text, cls)
  node.type = 'button'
  node.onclick = action
  return node
}
function announce(text) { get('notice').textContent = text; get('undo').hidden = !undo }
function focus(id) { (get(id) || get('drawer')).focus({ preventScroll: true }) }
function availability(player) {
  if (pending.has(player.id)) {
    clearTimeout(pending.get(player.id)); pending.delete(player.id)
    renderPlayers(); focus('status-' + player.id); announce(player.name + ' stays ' + (player.active ? 'active' : 'inactive')); return
  }
  undo = null
  pending.set(player.id, setTimeout(() => {
    pending.delete(player.id); commitAvailability(player)
  }, 2000))
  renderPlayers(); focus('status-' + player.id); announce('Moving ' + player.name + ' in two seconds. Tap again to cancel.')
}
function commitAvailability(player) {
  const hadFocus = document.activeElement?.id === 'status-' + player.id
  const focusId = document.activeElement?.id
  const active = players.filter(item => item.active), index = active.indexOf(player)
  const before = { active: player.active, side: player.side }
  player.active = !player.active
  player.side = 'Reserve'
  undo = () => {
    Object.assign(player, before); undo = null; renderPlayers(); focus('status-' + player.id); announce('Availability restored')
  }
  renderPlayers()
  if (hadFocus) focus('status-' + (player.active ? player.id : (active[index + 1] || active[index - 1])?.id))
  else if (focusId) get(focusId)?.focus({ preventScroll: true })
  announce(player.name + (player.active ? ' is active' : ' moved to Inactive'))
}
function setSide(player, side) {
  if (pending.has(player.id)) return
  const previous = player.side
  player.side = side; undo = null; renderPlayers(); focus('side-' + player.id); announce(player.name + ' · ' + side)
  if (config.side === 'segments' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const pill = get('side-' + player.id).firstElementChild
    const distance = (sides.indexOf(previous) - sides.indexOf(side)) * pill.parentElement.offsetWidth
    pill.animate([{ transform: 'translateX(' + distance + 'px)' }, { transform: 'translateX(0)' }], { duration: 300, easing: 'ease-out' })
  }
}
function sideControl(player) {
  const group = element('div', '', 'side-control')
  const label = 'Side for ' + player.name
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', label)
  if (config.side === 'select') {
    const select = element('select'); select.setAttribute('aria-label', label); select.id = 'side-' + player.id
    sides.forEach(side => select.add(new Option(side, side, false, side === player.side)))
    select.onchange = () => setSide(player, select.value); group.append(select)
  } else if (config.side === 'cycle') {
    const next = sides[(sides.indexOf(player.side) + 1) % sides.length]
    const control = button('', () => setSide(player, next), 'cycle'); control.append(element('span', player.side + ' ↻'))
    control.id = 'side-' + player.id; control.setAttribute('aria-label', label + ': ' + player.side + '. Change to ' + next); group.append(control)
  } else {
    for (const side of sides) {
      const control = button('', () => setSide(player, side)); control.append(element('span', side))
      control.dataset.side = side; control.setAttribute('aria-pressed', String(player.side === side))
      if (player.side === side) control.id = 'side-' + player.id
      group.append(control)
    }
    let start
    group.ontouchstart = event => { start = event.touches.length === 1 && event.touches[0] }
    group.addEventListener('touchend', event => {
      if (!start) return
      const end = event.changedTouches[0], dx = end.clientX - start.clientX, dy = end.clientY - start.clientY
      start = null
      if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      event.preventDefault(); setSide(player, sides[Math.max(0, Math.min(2, sides.indexOf(player.side) + Math.sign(dx)))])
    }, { passive: false })
  }
  return group
}
function card(player) {
  const active = pending.has(player.id) ? !player.active : player.active
  const node = element('article', '', 'card'), state = active ? 'Active' : 'Inactive', off = active ? '' : ' off'
  node.dataset.frame = config.frame; node.dataset.side = player.side
  const photoMode = config.status === 'photo'
  const portrait = photoMode ? button('', () => availability(player), 'portrait' + off) : element('div', '', 'portrait' + off)
  if (player.photo) { const img = element('img'); img.src = player.photo; img.alt = ''; portrait.append(img) }
  else portrait.textContent = player.name.slice(0, 2).toUpperCase()
  const name = element('div', '', 'name'); name.append(element('strong', player.name))
  if (player.last) name.append(element('small', 'Last game · ' + player.last))
  const status = photoMode ? element('span', state, 'photo-label' + off) : button('', () => availability(player), 'status' + off)
  if (photoMode) portrait.append(element('span', '', 'dot'))
  else {
    const wrap = element('span', '', 'wrap'); wrap.append(element('span', '', config.status === 'toggle' ? 'track' : 'dot'), state); status.append(wrap)
  }
  const toggle = photoMode ? portrait : status
  toggle.id = 'status-' + player.id; toggle.setAttribute('aria-label', player.name + ' · ' + state + ' · toggle availability')
  toggle.setAttribute('aria-pressed', String(active)); toggle.title = 'Make ' + player.name + (active ? ' inactive' : ' active')
  const more = button('⋯', () => edit(player), 'more'); more.setAttribute('aria-label', 'Edit ' + player.name)
  node.append(portrait, name, status, more)
  if (pending.has(player.id)) name.append(element('small', 'Moving… Tap again to cancel'))
  if (player.active) node.append(sideControl(player))
  return node
}
function renderPlayers() {
  get('list').replaceChildren(...players.filter(player => player.active).map(card))
  const inactive = players.filter(player => !player.active)
  get('drawer').textContent = (expanded ? '▾' : '▸') + ' Inactive (' + inactive.length + ')'
  get('drawer').setAttribute('aria-expanded', String(expanded))
  get('inactive').replaceChildren(...(expanded ? inactive.map(card) : []))
}
function renderControls() {
  const part = parts[tab]
  document.querySelectorAll('[role=tab]').forEach((node, index) => {
    node.setAttribute('aria-selected', String(index === tab)); node.tabIndex = index === tab ? 0 : -1
  })
  get('choices').setAttribute('aria-labelledby', 'tab-' + part.key)
  get('choices').replaceChildren(...Object.entries(part.options).map(([key, label]) => {
    const option = button(label, () => {
      config[part.key] = key; get('share').hidden = true
      for (const entry of parts) url.searchParams.set(entry.key, config[entry.key])
      history.replaceState(null, '', url); renderControls(); renderPlayers(); focus('choice-' + key)
    })
    option.id = 'choice-' + key; option.setAttribute('aria-pressed', String(config[part.key] === key)); return option
  }))
  get('summary').textContent = parts.map(entry => entry.options[config[entry.key]]).join(' · ')
}
parts.forEach((part, index) => {
  const control = button(part.label, () => { tab = index; renderControls() })
  control.id = 'tab-' + part.key; control.setAttribute('role', 'tab'); control.setAttribute('aria-controls', 'choices')
  control.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); tab = (index + (event.key === 'ArrowRight' ? 1 : -1) + parts.length) % parts.length; renderControls(); focus('tab-' + parts[tab].key)
  }
  get('tabs').append(control)
})
get('copy').onclick = async () => {
  for (const part of parts) url.searchParams.set(part.key, config[part.key])
  try { await navigator.clipboard.writeText(url.href); announce('Combination link copied') }
  catch { get('share').hidden = false; get('share').value = url.href; get('share').select() }
}
get('drawer').onclick = () => { expanded = !expanded; renderPlayers() }
get('undo').onclick = () => undo?.()
const dialog = document.querySelector('dialog')
function edit(player) {
  editing = player; get('field').value = player?.name ?? ''; get('title').textContent = player ? 'Edit gamer' : 'Add gamer'
  dialog.showModal(); get('field').focus()
}
get('add').onclick = () => edit(null); get('cancel').onclick = () => dialog.close()
dialog.querySelector('form').onsubmit = event => {
  event.preventDefault(); const name = get('field').value.trim(); if (!name) return
  const player = editing || { id: players.length, active: true, last: '', side: 'Reserve' }
  player.name = name; if (!editing) players.push(player)
  dialog.close(); undo = null; renderPlayers(); focus('status-' + player.id); announce(name + ' saved')
}
renderControls(); renderPlayers()
