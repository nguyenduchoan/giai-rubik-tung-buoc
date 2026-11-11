/* Điều khiển tab học; trạng thái và mô hình riêng, không sửa dữ liệu chụp/giải. */
(function () {
  'use strict';

  const { cube: C, Cube3D, lessons: course, vision: V } = window.Rubik;
  const { levels, lessons, formulas, exampleStart } = course;
  const $ = (selector) => document.querySelector(selector);
  const STORE_KEY = 'rubik-learning-v1';
  const knownIds = new Set(lessons.map((lesson) => lesson.id));
  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { /* Không đọc được tiến độ cũ. */ }
  if (!saved || typeof saved !== 'object') saved = {};
  let current = lessons.findIndex((lesson) => lesson.id === saved.lesson);
  if (current < 0) current = 0;
  const completed = new Set(Array.isArray(saved.completed) ? saved.completed.filter((id) => knownIds.has(id)) : []);
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ lesson: lessons[current].id, completed: [...completed] })); }
    catch (e) { $('#learn-storage-note').hidden = false; }
  };

  // Cùng hệ màu với khối ứng dụng, lật để trắng dưới / vàng trên / xanh lá trước.
  const palette = { U: 1, R: 3, F: 5, D: 0, L: 2, B: 4 };
  const hex = (face) => V.PALETTE[palette[face]].hex;
  const faceNames = { U: 'TRÊN', R: 'PHẢI', F: 'TRƯỚC', D: 'DƯỚI', L: 'TRÁI', B: 'SAU' };
  const view = new Cube3D($('#learn-cube'), { size: window.innerWidth < 500 ? 40 : 46 });
  let active = false;
  let selectedFormula = null;
  let moves = [];
  let start = Array.from(C.SOLVED);
  let step = 0;
  let playing = false;
  let run = 0;
  let exampleVersion = 0;
  const colorsAt = (index) => C.applyMoves(start, moves.slice(0, index)).map(hex);

  function stop() {
    playing = false;
    run++;
  }

  function renderNavigation() {
    const lesson = lessons[current];
    $('#learn-progress-text').textContent = `${completed.size}/${lessons.length} bài đã tự làm được`;
    $('#learn-progress').max = lessons.length;
    $('#learn-progress').value = completed.size;
    const levelList = $('#learn-levels');
    levelList.replaceChildren();
    levels.forEach((level, index) => {
      const button = create('button', 'learn-level');
      button.type = 'button';
      button.dataset.level = level.id;
      button.setAttribute('aria-pressed', String(lesson.level === level.id));
      button.append(create('strong', '', `${index + 1}. ${level.title}`), create('span', '', level.subtitle));
      button.addEventListener('click', () => selectLesson(lessons.findIndex((item) => item.level === level.id), true));
      levelList.appendChild(button);
    });
    $('#learn-level-title').textContent = levels.find((level) => level.id === lesson.level).title;
    const list = $('#learn-lessons');
    list.replaceChildren();
    lessons.forEach((item, index) => {
      if (item.level !== lesson.level) return;
      const entry = create('li');
      const button = create('button', 'learn-lesson');
      button.type = 'button';
      button.dataset.lesson = item.id;
      if (index === current) button.setAttribute('aria-current', 'step');
      button.append(create('strong', '', `${completed.has(item.id) ? '✓ ' : ''}${item.title}`), create('span', '', item.summary));
      button.addEventListener('click', () => selectLesson(index, true));
      entry.appendChild(button);
      list.appendChild(entry);
    });
    $('#learn-complete').checked = completed.has(lesson.id);
    $('#learn-previous-lesson').disabled = current === 0;
    $('#learn-next-lesson').disabled = current === lessons.length - 1;
  }

  function renderPlayer() {
    if (!view.animating) view.setColors(colorsAt(step));
    view.setHighlight(!view.animating && moves[step] ? moves[step].face : null);
    const done = step >= moves.length;
    $('#learn-counter').textContent = `Đã làm ${step}/${moves.length} nước`;
    $('#learn-move').textContent = done ? '✓' : C.moveToString(moves[step]);
    if (done) {
      $('#learn-description').textContent = 'Đã hết chuỗi. Đối chiếu kết quả với mục tiêu của công thức.';
    } else {
      const move = moves[step];
      const angle = move.power === 2 ? '180° (nửa vòng)' : `90° ${move.power === 3 ? 'ngược' : 'theo'} chiều kim đồng hồ`;
      $('#learn-description').textContent = `Tiếp: xoay mặt ${faceNames[move.face]} ${angle}, khi nhìn thẳng vào mặt đó.`;
    }
    $('#learn-reset').disabled = view.animating || playing || step === 0;
    $('#learn-prev').disabled = view.animating || playing || step === 0;
    $('#learn-next').disabled = view.animating || playing || done;
    $('#learn-play').disabled = view.animating && !playing;
    $('#learn-play').textContent = playing ? '⏸ Dừng' : done ? '↻ Xem lại' : '▶ Tự chạy';
    $('#learn-play').setAttribute('aria-pressed', String(playing));
    $('#learn-moves').querySelectorAll('button').forEach((button, index) => {
      button.classList.toggle('done', index < step);
      button.classList.toggle('current', index === step);
      button.disabled = view.animating || playing;
      if (index === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  }

  function selectFormula(id) {
    stop();
    exampleVersion++;
    selectedFormula = id;
    step = 0;
    const formula = formulas[id];
    moves = C.parseMoves(formula.sequence);
    start = exampleStart(formula);
    $('#learn-formula-title').textContent = formula.name;
    $('#learn-when').textContent = formula.when;
    $('#learn-result').textContent = formula.result;
    $('#learn-example-note').textContent = formula.motion
      ? 'Mẫu bắt đầu từ khối đã giải để quan sát tác động của chuỗi động tác.'
      : 'Mẫu đã được chuẩn bị đúng trường hợp để chạy hết công thức sẽ giải xong. Trên khối thật, chỉ phần đang học cần đạt mục tiêu; các phần khác có thể vẫn chưa xong.';
    $('#learn-chunks').replaceChildren(...formula.chunks.map((chunk) => create('code', '', chunk)));
    $('#learn-formulas').querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.formula === id));
    });
    const list = $('#learn-moves');
    list.replaceChildren();
    moves.forEach((move, index) => {
      const button = create('button', '', C.moveToString(move));
      button.type = 'button';
      button.setAttribute('aria-label', `Về trước nước ${index + 1}: ${C.moveToString(move)}`);
      button.addEventListener('click', () => {
        if (view.animating) return;
        stop();
        step = index;
        renderPlayer();
      });
      list.appendChild(button);
    });
    renderPlayer();
  }

  function selectLesson(index, focus = false) {
    if (index < 0 || index >= lessons.length) return;
    stop();
    exampleVersion++;
    current = index;
    const lesson = lessons[current];
    $('#learn-position').textContent = `BÀI ${current + 1} / ${lessons.length}`;
    for (const key of ['title', 'intro', 'goal', 'tip', 'check']) $('#learn-' + key).textContent = lesson[key];
    $('#learn-steps').replaceChildren(...lesson.steps.map((text) => create('li', '', text)));
    $('#learn-notation').hidden = !lesson.notation;
    const roadmap = $('#learn-roadmap');
    roadmap.hidden = !lesson.roadmap;
    roadmap.replaceChildren();
    if (lesson.roadmap) {
      const stages = lesson.id === 'cfop'
        ? [['white-cross', 'Dấu cộng'], ['f2l', 'F2L · Hai tầng đầu'], ['oll', 'OLL · Định hướng'], ['pll', 'PLL · Hoán vị']]
        : lessons.filter((item) => item.level === 'beginner').map((item) => [item.id, item.title]);
      stages.forEach(([id, title]) => {
        const button = create('button', 'btn small', title);
        button.type = 'button';
        button.addEventListener('click', () => selectLesson(lessons.findIndex((item) => item.id === id), true));
        roadmap.appendChild(button);
      });
    }
    $('#learn-practice').hidden = lesson.formulas.length === 0;
    const options = $('#learn-formulas');
    options.replaceChildren();
    lesson.formulas.forEach((id) => {
      const button = create('button', 'btn small', formulas[id].name);
      button.type = 'button';
      button.dataset.formula = id;
      button.addEventListener('click', () => selectFormula(id));
      options.appendChild(button);
    });
    if (lesson.formulas.length) selectFormula(lesson.formulas[0]);
    else {
      selectedFormula = null;
      moves = [];
      start = Array.from(C.SOLVED);
      step = 0;
    }
    renderNavigation();
    save();
    if (focus) $('#learn-title').focus({ preventScroll: false });
  }

  async function animate(delta) {
    const target = step + delta;
    if (!active || !moves.length || view.animating || target < 0 || target > moves.length) return;
    const version = exampleVersion;
    const move = delta > 0 ? moves[step] : C.inverseMove(moves[target]);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Number($('#learn-speed').value);
    const pending = view.animateMove(move, duration, () => {
      // Nước xoay cũ có thể kết thúc sau khi đã đổi bài/công thức.
      if (version === exampleVersion) step = target;
      view.setColors(colorsAt(step));
    });
    renderPlayer();
    await pending;
    renderPlayer();
  }

  async function play() {
    if (playing) { stop(); renderPlayer(); return; }
    if (!active || !selectedFormula || view.animating) return;
    if (step === moves.length) step = 0;
    playing = true;
    const token = ++run;
    const isPlaying = () => playing && active && token === run;
    renderPlayer();
    while (isPlaying() && step < moves.length) {
      await animate(1);
      if (isPlaying()) await new Promise((resolve) => setTimeout(resolve, Number($('#learn-speed').value) * 0.35));
    }
    if (token !== run) return;
    playing = false;
    renderPlayer();
  }

  $('#learn-next').addEventListener('click', () => { stop(); void animate(1); });
  $('#learn-prev').addEventListener('click', () => { stop(); void animate(-1); });
  $('#learn-play').addEventListener('click', () => { void play(); });
  $('#learn-reset').addEventListener('click', () => {
    if (view.animating) return;
    stop();
    step = 0;
    renderPlayer();
  });
  $('#learn-view').addEventListener('click', () => view.resetView());
  $('#learn-previous-lesson').addEventListener('click', () => selectLesson(current - 1, true));
  $('#learn-next-lesson').addEventListener('click', () => selectLesson(current + 1, true));
  $('#learn-complete').addEventListener('change', (event) => {
    if (event.target.checked) completed.add(lessons[current].id);
    else completed.delete(lessons[current].id);
    save();
    renderNavigation();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stop(); if (moves.length) renderPlayer(); }
  });
  window.Rubik.learn = {
    setActive(value) {
      active = value;
      if (!active) stop();
      if (moves.length) renderPlayer();
    },
  };
  selectLesson(current);
})();
