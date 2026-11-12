const fs = require('fs');
const d = require('docx');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, AlignmentType, LevelFormat, HeadingLevel, Footer, PageNumber, VerticalAlign } = d;

const FONT = 'Arial', INK = '1F2933', MUTED = '5F6B7A', ACCENT = '6D28D9', LINE = 'D5DAE1', SOFT = 'F3F0FA';
const W = 9026;

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 21, color: INK, ...o });
// parts: string | [text, opts]
const para = (parts, o = {}) => new Paragraph({
  spacing: { after: 100, line: 288 }, ...o,
  children: (Array.isArray(parts) ? parts : [parts]).map(x => typeof x === 'string' ? run(x) : run(x[0], x[1])),
});
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const li = (parts, ref = 'bul') => para(parts, { numbering: { reference: ref, level: 0 }, spacing: { after: 50, line: 276 } });
const B = t => [t, { bold: true }];

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const cell = (content, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders, verticalAlign: o.valign || VerticalAlign.TOP,
  margins: { top: 70, bottom: 70, left: 110, right: 110 },
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
  children: (Array.isArray(content) ? content : [content]).map(c => typeof c === 'string'
    ? new Paragraph({ alignment: o.align, spacing: { after: 0, line: 264 }, children: [run(c, { size: 19, bold: o.bold, color: o.color || INK })] })
    : c),
});
const table = (widths, head, rows, o = {}) => new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: widths,
  rows: [
    new TableRow({ tableHeader: true, cantSplit: true, children: head.map((t, i) => cell(t, widths[i], { fill: ACCENT, bold: true, color: 'FFFFFF', align: o.center && i > 0 ? AlignmentType.CENTER : undefined })) }),
    ...rows.map(r => new TableRow({ cantSplit: true, height: o.rowH ? { value: o.rowH, rule: 'atLeast' } : undefined,
      children: r.map((t, i) => cell(t, widths[i], { bold: i === 0 && o.boldFirst, fill: o.groupFill && o.groupFill(r) }))})),
  ],
});

const stages = [
  { n: 1, name: 'Перевод есть', group: 'А', req: 'На каждый непустой запрос модель возвращает перевод.',
    defects: ['пустой ответ или одни пробелы;',
      'исходный текст возвращён как есть (кроме строк, где переводить нечего: число, бренд, эмодзи);',
      'ответ оборван на полуслове;',
      'вместо перевода служебный текст: «Вот перевод:», «Я не могу…», сообщение об ошибке.'],
    gate: '100 % сегментов без дефекта', how: 'Автоматически' },
  { n: 2, name: 'Перевод на нужном языке', group: 'А', req: 'Весь ответ написан на запрошенном языке и в принятой для него письменности.',
    defects: ['другой язык: просили казахский, пришёл узбекский или английский;',
      'смесь языков, куски русского исходника остались непереведёнными;',
      'не та письменность: латиница вместо кириллицы или наоборот, традиционные иероглифы вместо упрощённых. Письменность по каждому языку фиксируем заранее.'],
    gate: '100 % сегментов без дефекта', how: 'Автоопределение языка; спорные короткие строки смотрит лингвист' },
  { n: 3, name: 'Не заикается', group: 'А', req: 'В ответе нет зацикливаний и мусора.',
    defects: ['слово или фраза повторяется подряд без причины: «Доброе утро утро утро утро…»;',
      'перевод в разы длиннее исходника за счёт повторов;',
      'один и тот же перевод выдан два раза подряд;',
      'случайные символы, обрывки разметки, битая кодировка.'],
    gate: '100 % сегментов без дефекта', how: 'Автоматически: повторы слов и фраз, отношение длины перевода к исходнику' },
  { n: 4, name: 'Ничего не потерял и не выдумал', group: 'Б', req: 'В переводе есть всё, что было в исходнике, и ничего сверх этого.',
    defects: ['пропущено предложение или значимая часть фразы;',
      'добавлены сведения, которых нет в исходнике;',
      'пояснения и комментарии от модели;',
      'несколько вариантов перевода вместо одного.'],
    gate: '≥ 99 % сегментов без дефекта', how: 'Автоматически по длине и числу предложений, плюс лингвист на выборке' },
  { n: 5, name: 'Технические элементы на месте', group: 'Б', req: 'Всё, что не переводится, перенесено без изменений.',
    defects: ['переменная потеряна, изменена или переведена: {name}, %s, {{count}};',
      'сломан или потерян тег, ссылка;',
      'изменены числа, цены, даты, артикулы, промокоды;',
      'потеряны или добавлены эмодзи;',
      'изменены переносы строк и пробелы по краям.'],
    gate: '100 % сегментов без дефекта', how: 'Автоматически: сравнение исходника и перевода' },
  { n: 6, name: 'Смысл передан верно', group: 'В', req: 'Читатель перевода понимает то же, что читатель исходника.',
    defects: ['смысл искажён или стал противоположным: потеряно отрицание, перепутано, кто кому и что делает;',
      'неверно переданы условия: сроки, размер скидки, ограничения;',
      'слово переведено не в том значении, идиома переведена буквально;',
      'переведено имя собственное или бренд, которые переводить не нужно.'],
    gate: '≥ 95 % сегментов без смысловых ошибок; критических ошибок (цена, условия акции, юридические формулировки) — 0', how: 'Лингвист, выборка 200 сегментов на язык' },
  { n: 7, name: 'Грамотно и естественно', group: 'В', req: 'Текст читается так, будто его написал носитель языка.',
    defects: ['орфография и пунктуация;',
      'грамматика: согласование, падежи, род, число, формы множественного числа рядом с переменными;',
      'калька с русского, неестественный порядок слов;',
      'заглавные буквы не по правилам языка.'],
    gate: '≥ 95 % сегментов без ошибок', how: 'Лингвист, та же выборка' },
  { n: 8, name: 'Термины по термбазе', group: 'Г', req: 'Термины и названия переведены так, как утверждено в термбазе.',
    defects: ['термин из термбазы переведён иначе;',
      'один и тот же термин переведён по-разному в пределах одного текста;',
      'название бренда, продукта или раздела не совпадает с утверждённым.'],
    gate: '≥ 98 % вхождений терминов переведены по термбазе', how: 'Автоматически по термбазе, плюс лингвист' },
  { n: 9, name: 'Стиль и формат', group: 'Г', req: 'Текст можно публиковать без правок редактора.',
    defects: ['не тот тон и форма обращения («ты» / «вы») для языка и продукта;',
      'даты, числа и валюты оформлены не по нормам языка;',
      'текст не уложился в лимит символов (пуш, баннер, кнопка);',
      'тяжёлая канцелярская фраза там, где нужен короткий рекламный текст.'],
    gate: '≥ 90 % сегментов лингвист принимает без правок', how: 'Лингвист, та же выборка' },
];
const groups = { 'А': 'Модель работает', 'Б': 'Перевод целый', 'В': 'Перевод правильный', 'Г': 'Перевод в нашем стиле' };

const body = [];
body.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Поэтапные критерии качества машинного перевода', font: FONT, size: 40, bold: true, color: INK })] }));
body.push(new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
  children: [run('Для команды ML  ·  от команды локализации  ·  12.11.2026', { color: MUTED, size: 20 })] }));

body.push(para('Качество оцениваем как лестницу из девяти этапов. Каждый этап — одно требование и один порог. Пока этап не закрыт, следующий не оцениваем: нет смысла обсуждать стиль, если модель оставляет пустые строки.'));

body.push(h1('Правила'));
[
  [B('Строго по порядку. '), 'К оценке следующего этапа не приступаем и замечания по нему не собираем, пока не закрыт предыдущий.'],
  [B('Этап закрыт, когда выполнен порог '), 'на согласованном тестовом наборе. Набор фиксируем один раз и не меняем между версиями модели.'],
  [B('Языки идут независимо. '), 'У каждой языковой пары свой текущий этап: один язык может быть на этапе 6, другой на этапе 3.'],
  [B('Закрытое перепроверяем. '), 'На каждой новой версии модели заново проверяем все закрытые этапы. Если закрытый этап сломался, возвращаемся к нему.'],
  [B('Пороги согласуем до старта. '), 'Цифры в этом документе — предложение команды локализации. После согласования с ML их не двигаем.'],
].forEach(x => body.push(li(x, 'num')));

body.push(h1('Этапы коротко'));
body.push(table([520, 2700, 3506, 2300], ['№', 'Этап', 'Закрыт, когда', 'Кто проверяет'],
  stages.map(s => [String(s.n), s.name, s.n === 6 ? '≥ 95 % сегментов без смысловых ошибок, критических — 0' : s.gate,
    ({1:'Скрипт',2:'Скрипт, спорное — лингвист',3:'Скрипт',4:'Скрипт и лингвист',5:'Скрипт',6:'Лингвист',7:'Лингвист',8:'Скрипт и лингвист',9:'Лингвист'})[s.n]]), { boldFirst: true }));
body.push(para([['Этапы 1–3 — «модель работает», 4–5 — «перевод целый», 6–7 — «перевод правильный», 8–9 — «перевод в нашем стиле».', { color: MUTED, size: 19 }]], { spacing: { before: 100, after: 100 } }));

body.push(h1('Тестовый набор'));
body.push(para('Предлагаем 500 сегментов на каждый язык из реальных текстов: пуши, баннеры, строки интерфейса, длинные тексты. В набор обязательно входят трудные случаи:'));
['одно слово и длинный абзац;', 'текст с переменными, тегами и ссылками;', 'числа, цены, даты, промокоды;', 'эмодзи, названия брендов, текст заглавными буквами.'].forEach(t => body.push(li(t)));

body.push(h1('Как идёт одна итерация'));
[
  'ML присылает переводы тестового набора и номер версии модели.',
  'Локализация проверяет закрытые этапы и текущий этап, по каждому языку отдельно.',
  'Локализация возвращает отчёт: этап, процент сегментов без дефекта, список дефектных сегментов с пометкой, что не так.',
  'Если порог выполнен, этап закрыт и на следующей итерации оцениваем следующий. Если нет, ML исправляет и присылает новую версию.',
].forEach(t => body.push(li(t, 'num2')));

body.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun('Этапы подробно')] }));
let lastGroup = null;
stages.forEach(s => {
  if (s.group !== lastGroup) {
    lastGroup = s.group;
    body.push(new Paragraph({ spacing: { before: 240, after: 80 }, keepNext: true,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT },
      children: [run(`Блок ${s.group}. ${groups[s.group]}`, { bold: true, color: ACCENT, size: 20 })] }));
  }
  body.push(h2(`Этап ${s.n}. ${s.name}`));
  body.push(para([B('Требование. '), s.req], { keepNext: true }));
  body.push(para([B('Считается дефектом:')], { keepNext: true, spacing: { after: 40 } }));
  s.defects.forEach(t => body.push(new Paragraph({ numbering: { reference: 'bul', level: 0 }, keepNext: true, spacing: { after: 40, line: 276 }, children: [run(t)] })));
  body.push(para([B('Закрыт, когда: '), s.gate + '.'], { keepNext: true, spacing: { before: 60, after: 40 } }));
  body.push(para([B('Проверка: '), s.how.charAt(0).toLowerCase() + s.how.slice(1) + '.']));
});

body.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun('Трекер: где мы сейчас')] }));
body.push(para('В ячейку ставим дату, когда этап закрыт по этому языку. Пустая ячейка — этап не закрыт. Список языков поправьте под реальный состав.'));
const langs = ['EN', 'KA', 'HY', 'KK', 'KY', 'TR', 'TG', 'UZ', 'ZH'];
const lw = 714, first = W - lw * langs.length;
body.push(table([first, ...langs.map(() => lw)], ['Этап', ...langs],
  stages.map(s => [`${s.n}. ${s.name}`, ...langs.map(() => '')]), { center: true, rowH: 520 }));

const doc = new Document({
  creator: 'Команда локализации', title: 'Поэтапные критерии качества машинного перевода',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: INK } },
      heading1: { run: { font: FONT, size: 28, bold: true, color: INK }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true } },
      heading2: { run: { font: FONT, size: 23, bold: true, color: INK }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
    },
  },
  numbering: { config: [
    { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] },
    { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 360 } } } }] },
    { reference: 'num2', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 360 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
      run('Критерии качества машинного перевода  ·  стр. ', { size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTED })] })] }) },
    children: body,
  }],
});
Packer.toBuffer(doc).then(b => fs.writeFileSync(process.argv[2], b));
