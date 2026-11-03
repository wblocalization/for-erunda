# Переносит старую таблицу Зары в новую структуру: python3 -I migrate.py old.xlsx new.xlsx
import sys, re, datetime, collections, openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter as L

src = openpyxl.load_workbook(sys.argv[1])
P, B, R = src.worksheets[1], src.worksheets[2], src.worksheets[3]
LANGS = ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN']
ALL6 = ['KK', 'KY', 'UZ', 'HY', 'TG', 'KA']
NAMES = {'казах': 'KK', 'кыргыз': 'KY', 'киргиз': 'KY', 'узбек': 'UZ', 'армян': 'HY', 'таджик': 'TG', 'грузин': 'KA', 'азербайджан': 'AZ', 'англ': 'EN'}
PRODUCTS = ['Магазинка', 'WB Банк', 'WB Клуб', 'WB Такси', 'WB Flot', 'Портал продавца', 'Другое']
TYPES = ['Пуш', 'Баннер', 'Имейл', 'Исследование', 'Инструкция', 'Другое']
BTYPES = ['Лайн', 'Саблайн', 'Плашка', 'CTA-кнопка', 'Дисклеймер', 'ГЗК (радио / тв)', 'Другое']
STATUSES = ['🆕 Новый', '♻️ Из архива', '⚠️ Проверить', '📤 У подрядчика', '✅ Готово', '📨 Отдан', '✖️ Отменён']
SENT = '📨 Отдан'

def s(v): return '' if v is None else str(v).strip()
def langs(v):
    t = s(v).lower()
    if not t: return []
    if re.search(r'\bвс[еёи]\b', t): return ALL6
    out = [code for k, code in NAMES.items() if k in t]
    out += [c for c in LANGS if re.search(r'\b' + c.lower() + r'\b', t)]
    return [c for c in LANGS if c in out]
def product(v):
    t = re.sub(r'\s+', ' ', s(v))
    for p in PRODUCTS:
        if t.lower() == p.lower(): return p
    return t
# Строки-образцы («ПРИМЕР ЗАПОЛНЕНИЯ»): вместо перевода там подсказка «Текст на узбекском».
def is_sample(tr):
    return any(re.search(r'^\s*текст\s*(пуша\s*)?на\s*\w+|^\s*текстна', s(x), re.I) for x in tr)

def limit(v):
    m = re.search(r'\d+', s(v).replace('.0', ''))
    return int(m.group()) if m else None

rows = []
# Пуши: строки без даты продолжают запрос над ними (дата, продукт, языки).
last = {}
for r in P.iter_rows(min_row=2, values_only=True):
    ru = s(r[5])
    if not ru or ru.upper().startswith('ПРИМЕР'): continue
    if isinstance(r[0], datetime.datetime): last = {'date': r[0], 'product': r[1], 'langs': r[2]}
    elif not last: continue
    tr = dict(zip(['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ'], [s(x) for x in r[6:13]]))
    if is_sample(tr.values()): continue
    rows.append(dict(date=last['date'], type='Пуш', btype='', product=product(r[1] or last['product']),
                     langs=langs(r[2] or last['langs']), limit=limit(r[4]), ctx=s(r[3]), ru=ru, tr=tr))
for r in B.iter_rows(min_row=2, values_only=True):
    ru = s(r[6])
    if not ru or not isinstance(r[0], datetime.datetime): continue
    tr = dict(zip(['KK', 'KY', 'UZ', 'HY', 'TG', 'KA', 'AZ', 'EN'], [s(x) for x in r[7:15]]))
    if is_sample(tr.values()): continue
    rows.append(dict(date=r[0], type='Баннер', btype=s(r[3]), product=product(r[1]), langs=langs(r[2]),
                     limit=limit(r[5]), ctx=s(r[4]), ru=ru, tr=tr))
rows.sort(key=lambda x: (x['date'], x['type']))
cnt = collections.Counter()
for x in rows:
    pre = 'P' if x['type'] == 'Пуш' else 'B'
    cnt[pre] += 1
    x['id'] = '%s-%04d' % (pre, cnt[pre])
    want = x['langs'] or [c for c in LANGS if x['tr'].get(c)]
    x['langs'] = want
    # Старые строки — уже отданы. Если каких-то языков не хватало, пишем это в «Уже переводили?».
    miss = [c for c in want if not x['tr'].get(c)]
    x['status'] = SENT
    x['note'] = ('⚠️ при переносе не было перевода: ' + ', '.join(miss)) if miss else ''

LANG_COLORS = {'KK': '1F8A8A', 'KY': 'C0392B', 'UZ': '2A78D6', 'HY': 'D9822B', 'TG': '2E8B57', 'KA': 'B0306A', 'AZ': '5B4BC4', 'EN': '5F6B7A'}
ACCENT = PatternFill('solid', fgColor='C2477A')
MAIN_COLS = ('Текст RU', 'Статус', 'Уже переводили?')
import math

# Заголовок = иконка + название (по нему скрипт ищет колонку) + серая подсказка второй строкой.
# ✍️ розовые — заполняет заказчик, 🤖 серые — заполняются сами, цветные коды — переводы.
CLIENT = {'Тип баннера': 'из списка', 'Продукт': 'из списка', 'Языки': '«все» или KK, UZ…', 'Лимит': 'символов',
          'Дедлайн': 'когда нужен', 'Ссылка (тред / Figma)': 'Band / Figma', 'Контекст': 'где и зачем этот текст',
          'Текст RU': 'одна строка = один текст'}
AUTO = {'ID': 'сам', 'Дата': 'сама', 'Статус': 'меняет локализация', 'Уже переводили?': 'таблица ищет в архиве сама'}
LANG_NAMES = {'KK': 'казахский', 'KY': 'кыргызский', 'UZ': 'узбекский', 'HY': 'армянский', 'TG': 'таджикский', 'KA': 'грузинский', 'AZ': 'азербайджанский', 'EN': 'английский'}
CLIENT_FILL = PatternFill('solid', fgColor='C2477A')
AUTO_FILL = PatternFill('solid', fgColor='6B6580')
STATUS_FILL = PatternFill('solid', fgColor='2E2566')

def head_text(name):
    if name in CLIENT: return '✍️ %s\n%s' % (name, CLIENT[name])
    if name in AUTO: return '🤖 %s\n%s' % (name, AUTO[name])
    if name in LANG_NAMES: return '%s\n%s' % (name, LANG_NAMES[name])
    return name

def head_fill(name):
    if name in LANG_COLORS: return PatternFill('solid', fgColor=LANG_COLORS[name])
    if name == 'Статус': return STATUS_FILL
    if name in CLIENT: return CLIENT_FILL
    if name in AUTO: return AUTO_FILL
    return HFILL

from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
B_FONT = InlineFont(b=True, color='FFFFFF', sz=11)
S_FONT = InlineFont(color='F3EEFA', sz=9, i=True)

def style_head(ws, cols):
    for c, name in zip(ws[1], cols):
        t = head_text(name)
        if '\n' in t:   # название жирным, подсказка мелко
            a, b = t.split('\n', 1)
            c.value = CellRichText([TextBlock(B_FONT, a + '\n'), TextBlock(S_FONT, b)])
        else:
            c.value = t
        c.font = HEAD; c.fill = head_fill(name)
        c.alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[1].height = 40

def fit_rows(ws, widths):
    # Высота строки по самому длинному тексту: ширина колонки в символах ≈ сколько букв влезает в строку.
    for row in ws.iter_rows(min_row=2):
        lines = 1
        for c in row:
            if c.value is None: continue
            w = max(widths[c.column - 1] * 1.05, 4)
            n = sum(max(1, math.ceil(len(part) / w)) for part in str(c.value).split('\n'))
            lines = max(lines, n)
        ws.row_dimensions[row[0].row].height = min(15 * lines + 6, 400)

wb = openpyxl.Workbook()
HEAD = Font(bold=True, color='FFFFFF')
HFILL = PatternFill('solid', fgColor='2E2566')
LFILL = PatternFill('solid', fgColor='4A3A8C')
thin = Border(bottom=Side(style='thin', color='E6E3EF'))
WRAP = Alignment(wrap_text=True, vertical='top')

# --- Пуши и Баннеры: отдельные вкладки, колонки ищутся скриптом по названиям ---
WIDTH = {'ID': 10, 'Дата': 11, 'Тип баннера': 13, 'Продукт': 14, 'Языки': 18, 'Лимит': 10, 'Дедлайн': 14,
         'Ссылка (тред / Figma)': 16, 'Контекст': 28, 'Текст RU': 50, 'Статус': 17, 'Уже переводили?': 34}
# Статус: заливка + цвет текста. Отданные и отменённые строки — серым текстом, чтобы в глаза бросались живые.
STATUS_COLORS = {'🆕 Новый': ('FFD3E2', 'A1204F'), '♻️ Из архива': ('CDEFDC', '17683F'), '⚠️ Проверить': ('FFE7B0', '7A4F00'),
                 '📤 У подрядчика': ('D6E6FB', '1D5FB8'), '✅ Готово': ('E0D9FA', '4A3A8C'), '📨 Отдан': ('EEEEEE', '6B6B6B'), '✖️ Отменён': ('F5F5F5', '9A9A9A')}

def build_requests(ws, items, banner, tab):
    cols = ['ID', 'Дата'] + (['Тип баннера'] if banner else []) + ['Продукт', 'Языки', 'Лимит', 'Дедлайн',
            'Ссылка (тред / Figma)', 'Контекст', 'Текст RU', 'Статус', 'Уже переводили?'] + LANGS
    widths = [WIDTH.get(c, 42) for c in cols]
    ws.append(cols)
    for i, w in enumerate(widths, 1): ws.column_dimensions[L(i)].width = w
    style_head(ws, cols)
    ws.sheet_properties.tabColor = tab
    items = sorted(items, key=lambda x: (x['date'], x['id']))
    for x in items:
        val = {'ID': x['id'], 'Дата': x['date'].date(), 'Тип баннера': x['btype'], 'Продукт': x['product'], 'Языки': ', '.join(x['langs']),
               'Лимит': x['limit'], 'Дедлайн': None, 'Ссылка (тред / Figma)': '', 'Контекст': x['ctx'], 'Текст RU': x['ru'],
               'Статус': x['status'], 'Уже переводили?': x['note']}
        ws.append([val[c] if c in val else x['tr'].get(c, '') for c in cols])
    n = ws.max_row
    ci = {c: i for i, c in enumerate(cols)}
    for row in ws.iter_rows(min_row=2, max_row=n):
        row[ci['Дата']].number_format = 'DD.MM.YYYY'
        row[ci['Дедлайн']].number_format = 'DD.MM.YYYY HH:MM'
        for c in row: c.alignment = WRAP; c.border = thin
    ws.freeze_panes = 'B2'
    fit_rows(ws, widths)
    ws.auto_filter.ref = 'A1:%s%d' % (L(len(cols)), n)
    big = n + 2000
    def dv(name, items_, title):
        col = L(ci[name] + 1)
        v = DataValidation(type='list', formula1='"' + ','.join(items_) + '"', allow_blank=True, errorStyle='warning',
                           showErrorMessage=True, errorTitle=title, error='Выберите значение из списка')
        ws.add_data_validation(v); v.add('%s2:%s%d' % (col, col, big))
    if banner: dv('Тип баннера', BTYPES, 'Тип баннера')
    dv('Продукт', PRODUCTS, 'Продукт'); dv('Статус', STATUSES, 'Статус')
    sc = L(ci['Статус'] + 1)
    for st, (bgc, fg) in STATUS_COLORS.items():
        ws.conditional_formatting.add('%s2:%s%d' % (sc, sc, big), FormulaRule(formula=['$%s2="%s"' % (sc, st)],
            fill=PatternFill('solid', bgColor=bgc), font=Font(bold=True, color=fg)))
    # Новый запрос — розовый ID, чтобы сразу видеть, что ждёт разбора.
    idc = L(ci['ID'] + 1)
    ws.conditional_formatting.add('%s2:%s%d' % (idc, idc, big), FormulaRule(formula=['$%s2="🆕 Новый"' % sc],
        fill=PatternFill('solid', bgColor='FFD3E2'), font=Font(bold=True, color='A1204F')))
    # Закрытые строки — серый текст (кроме статуса и переводов).
    gray = FormulaRule(formula=['OR($%s2="📨 Отдан",$%s2="✖️ Отменён")' % (sc, sc)], font=Font(color='8C8A94'))
    ws.conditional_formatting.add('%s2:%s%d' % (L(ci['Дата'] + 1), L(ci['Статус']), big), gray)
    mc = L(ci['Уже переводили?'] + 1)
    ws.conditional_formatting.add('%s2:%s%d' % (mc, mc, big), gray)

ws = wb.active; ws.title = '📥 Пуши'
build_requests(ws, [x for x in rows if x['type'] == 'Пуш'], False, 'E5638F')
build_requests(wb.create_sheet('🖼 Баннеры'), [x for x in rows if x['type'] == 'Баннер'], True, 'F28A5B')

# --- Архив ---
wa = wb.create_sheet('📚 Архив переводов')
wa.append(['Источник', 'Дата', 'Тип', 'Текст RU'] + LANGS)
awidths = [22, 11, 9, 50] + [42] * len(LANGS)
for i, w in enumerate(awidths, 1): wa.column_dimensions[L(i)].width = w
style_head(wa, ['Источник', 'Дата', 'Тип', 'Текст RU'] + LANGS)
wa.sheet_properties.tabColor = '2A78D6'
srcname = ''
for r in R.iter_rows(min_row=2, values_only=True):
    if s(r[0]): srcname = s(r[0])
    ru = s(r[1])
    if not ru: continue
    tr = [s(x) for x in r[2:9]]
    if not any(tr) or is_sample(tr): continue
    wa.append([srcname, None, 'Пуш', ru] + tr + [''])
for row in wa.iter_rows(min_row=2):
    for c in row: c.alignment = WRAP
wa.freeze_panes = 'E2'
fit_rows(wa, awidths)

# --- Статистика ---
st = wb.create_sheet('📊 Статистика')
st.sheet_properties.tabColor = '2E8B57'
st['A1'] = 'Статистика появится после настройки: меню «🌍 Переводы» → «Обновить статистику».'
st['A1'].font = Font(bold=True, size=13)

# --- Как заполнять ---
hp = wb.create_sheet('📖 Как заполнять')
hp.sheet_properties.tabColor = 'F2A33A'
hp.sheet_view.showGridLines = False
hp.column_dimensions['A'].width = 4; hp.column_dimensions['B'].width = 24; hp.column_dimensions['C'].width = 80
def fill(c): return PatternFill('solid', fgColor=c)
H1 = Font(bold=True, size=15, color='2E2566'); H2 = Font(bold=True, size=12, color='2E2566')
blocks = [
    ('h1', 'Как заказать перевод — 3 шага'),
    ('step', '1', 'Откройте вкладку «📥 Пуши» (или «🖼 Баннеры») и встаньте в первую пустую строку внизу.'),
    ('step', '2', 'Заполните розовые колонки ✍️: продукт, языки, текст RU (+ лимит, дедлайн, ссылка, контекст, если есть).'),
    ('step', '3', 'Всё. ID, дата, статус и подсказки из архива появятся сами через пару секунд.'),
    ('gap',),
    ('h2', 'Цвета заголовков'),
    ('swatch', 'C2477A', 'FFFFFF', '✍️ Заказчик', 'Заполняете вы. Подсказка — серой строкой в заголовке.'),
    ('swatch', '6B6580', 'FFFFFF', '🤖 Автоматически', 'Не трогайте: ID, дата и «Уже переводили?» заполняются сами.'),
    ('swatch', '2E2566', 'FFFFFF', 'Статус', 'Меняет локализация.'),
    ('swatch', '1F8A8A', 'FFFFFF', 'KK, UZ, …', 'Переводы. У каждого языка свой цвет.'),
    ('gap',),
    ('h2', 'Статусы'),
] + [('swatch', bgc, fg, st, d) for (st, (bgc, fg)), d in zip(STATUS_COLORS.items(), [
    'Ждёт разбора локализацией.', 'Такой текст уже переводили — переводы подставлены, заказывать не нужно.',
    'Подставлено из архива, но отличаются цифры или знаки — локализация проверит.', 'Отдан переводчику.',
    'Переводы на месте.', 'Переводы отданы заказчику. Строка становится серой.', 'Запрос отменён.'])] + [
    ('gap',),
    ('h2', 'Ячейки переводов'),
    ('swatch', 'E2F6EC', '17683F', 'зелёная', 'Взято из архива — тот же текст или отличается только эмодзи. Можно брать.'),
    ('swatch', 'FFF4DC', '7A4F00', 'жёлтая', 'Из архива, но цифры или знаки другие — проверить.'),
    ('swatch', 'FFD6E0', 'A1204F', 'красная', 'Перевод длиннее лимита.'),
    ('gap',),
    ('h2', 'Как писать языки'),
    ('row', 'Языки', 'Через запятую: «казахский, узбекский» или «KK, UZ». «все» = KK, KY, UZ, HY, TG, KA.'),
    ('row', 'Один текст', 'Одна строка = один текст. Заголовок и текст пуша — две строки.'),
    ('row', 'Нет продукта', 'Выберите «Другое» и напишите продукт в «Контекст».'),
    ('gap',),
    ('h2', 'Сроки'),
    ('row', 'до 300 слов', 'от 1 рабочего дня'),
    ('row', '300–1000 слов', '2–3 рабочих дня'),
    ('row', '1000+ слов', 'обсуждаем'),
]
r = 2
for b in blocks:
    if b[0] == 'h1': hp.cell(r, 2, b[1]).font = H1; hp.row_dimensions[r].height = 28
    elif b[0] == 'h2': hp.cell(r, 2, b[1]).font = H2; hp.row_dimensions[r].height = 22
    elif b[0] == 'step':
        c = hp.cell(r, 2, 'Шаг ' + b[1]); c.font = Font(bold=True, color='FFFFFF'); c.fill = fill('E5638F'); c.alignment = Alignment(horizontal='center', vertical='center')
        hp.cell(r, 3, b[2]).alignment = Alignment(wrap_text=True, vertical='center'); hp.row_dimensions[r].height = 30
    elif b[0] == 'swatch':
        c = hp.cell(r, 2, b[3]); c.fill = fill(b[1]); c.font = Font(bold=True, color=b[2]); c.alignment = Alignment(horizontal='center', vertical='center')
        hp.cell(r, 3, b[4]).alignment = Alignment(wrap_text=True, vertical='center'); hp.row_dimensions[r].height = 24
    elif b[0] == 'row':
        hp.cell(r, 2, b[1]).font = Font(bold=True); hp.cell(r, 3, b[2]).alignment = Alignment(wrap_text=True, vertical='center'); hp.row_dimensions[r].height = 22
    r += 1

# --- Справочники ---
dc = wb.create_sheet('⚙️ Справочники')
dc.sheet_properties.tabColor = '8A8A8A'
dc.append(['Продукты', 'Тип баннера', 'Статус', 'Язык (код)', 'Как пишут'])
syn = {'KK': 'казахский, KK-CYR', 'KY': 'кыргызский, киргизский', 'UZ': 'узбекский, uz-Latn', 'HY': 'армянский', 'TG': 'таджикский', 'KA': 'грузинский', 'AZ': 'азербайджанский', 'EN': 'английский'}
for i in range(max(len(PRODUCTS), len(BTYPES), len(STATUSES), len(LANGS))):
    g = lambda lst: lst[i] if i < len(lst) else None
    dc.append([g(PRODUCTS), g(BTYPES), g(STATUSES), g(LANGS), syn.get(g(LANGS)) if g(LANGS) else None])
for c in dc[1]: c.font = HEAD; c.fill = HFILL
for i in range(1, 7): dc.column_dimensions[L(i)].width = 22

wb.save(sys.argv[2])
print('запросов:', len(rows), dict(cnt), 'архив:', wa.max_row - 1, 'без части языков:', sum(1 for x in rows if x['note']))
