export type Language = 'ru' | 'kk'

const ru = {
  cart: 'Корзина',
  assistant: 'Помощник EKT', assistantSubtitle: 'Каталог и условия покупки', closeChat: 'Свернуть чат',
  greeting: 'Здравствуйте! Подберу товар по артикулу или характеристикам, проверю остатки и объясню аналоги. Могу ответить про доставку и оплату.',
  suggestionsHeading: 'Например, спросите:', productSuggestion: 'Подобрать автомат', termsSuggestion: 'Условия оплаты',
  termsQuery: 'Какие есть способы оплаты?',
  you: 'Вы', source: 'Источник условий', noResults: 'Уточните артикул или характеристики товара.',
  searching: 'Ищу по каталогу', messageLabel: 'Сообщение помощнику EKT',
  messagePlaceholder: 'Например: нужен автомат 3P C16, 10 kA, 8 штук',
  demo: 'Demo', send: 'Отправить', openChat: 'Открыть чат с помощником EKT', askAssistant: 'Спросить помощника',
  languageLabel: 'Язык общения',
  readingMode: 'Для слабовидящих', modeEnabled: 'Вкл.', modeDisabled: 'Выкл.',
  conversationHistory: 'История переписки', chatHistory: 'История чатов', newChat: 'Новый чат',
  chatNavigation: 'Управление чатами', dialogues: 'Диалоги', untitledChat: 'Новый диалог', currentChat: 'Текущий', backToChat: 'Вернуться к чату',
  historyLifetime: 'История и черновики сохраняются в этом браузере. На общем устройстве удалите их после общения. Не вводите платёжные данные.',
  historyConflict: 'История обновилась в другой вкладке.', refreshHistory: 'Обновить историю',
  refreshHistoryWarning: 'Обновление удалит текущий несохранённый черновик.',
  historyStorageError: 'Не удалось сохранить историю или прочитать сохранённые данные. Проверьте настройки и свободное место браузера. Изменения могут исчезнуть после обновления; удаление не подтверждено.',
  restoredHistoryNote: 'Это сохранённая переписка, не актуальные цены и остатки. После обновления страницы повторите артикул или характеристики: контекст поиска начинается заново.',
  deleteChat: 'Удалить чат', clearHistory: 'Очистить историю', deleteConfirm: 'Удалить',
  deleteChatQuestion: 'Удалить этот чат?', clearHistoryQuestion: 'Удалить всю историю чатов?',
  deleteHistoryWarning: 'Переписка и черновики будут удалены из этого браузера без возможности восстановления. Корзина не изменится. Данные на сервере этим действием не удаляются.',
  previousResult: 'Предыдущий результат', previousResultNote: 'Данные из предыдущего ответа. Для покупки проверьте товар новым запросом.',
  shortQuery: 'Введите не менее 5 символов: артикул, название товара или вопрос об условиях покупки.',
  requestFailed: 'Не удалось выполнить запрос. Повторите попытку.',
  searchTimeout: 'Ответ не получен вовремя. Вопрос сохранён в переписке. Попробуйте ещё раз.',
  retryQuestion: 'Повторить вопрос',
  requestTimeout: 'Ответ не получен вовремя. Если вы добавляли товар, он уже мог попасть в корзину. Проверьте добавление; повторная попытка не дублирует товар.',
  serverUnavailable: 'Сервер помощника недоступен. Проверьте подключение и повторите запрос.',
  pendingCart: 'Добавление продолжается. Закрытие окна не отменяет запрос. После подтверждения сервером откроется корзина.',
  cartNeedsReview: 'Не удалось подтвердить добавление. Проверьте запрос перед повторной попыткой.',
  reviewCartRequest: 'Проверить добавление', hideRequest: 'Скрыть окно',
  resolveCartFirst: 'Сначала проверьте незавершённое добавление, прежде чем добавлять другой товар.',
  exactMatch: 'Точное совпадение', compatible: 'Предложенный аналог', inStock: 'В наличии', piece: 'шт.',
  productEvidence: 'Характеристики и наличие', catalogEvidenceSource: 'Данные из ответа каталога. Неуказанные характеристики требуют уточнения.',
  productBrand: 'Бренд', productPoles: 'Число полюсов', productCurve: 'Характеристика срабатывания', productCurrent: 'Номинальный ток', productCapacity: 'Отключающая способность', productPack: 'Кратность упаковки',
  catalogProperties: 'Свойства каталога', notProvided: 'Не указано', propertyYes: 'Да', propertyNo: 'Нет', unsupportedProperty: 'Формат значения не поддерживается.',
  noSpecifications: 'Технические характеристики не предоставлены.', warehouseStock: 'Остатки по складам', noWarehouseStock: 'Разбивка по складам не предоставлена.', unnamedWarehouse: 'Склад без названия',
  productCertificates: 'Сертификаты', noCertificates: 'Сертификаты не предоставлены в ответе каталога.', invalidCertificates: 'Часть ссылок недоступна или некорректна.', unnamedCertificate: 'Документ', opensNewTab: 'в новой вкладке',
  whyAlternative: 'Почему предложен аналог', missingReason: 'Обоснование аналога не предоставлено. Уточните совместимость.', compatibilityCaution: 'Совпадение указанных параметров не гарантирует полную взаимозаменяемость.', technicalWarning: 'Требуется проверка характеристик',
  multipleOf: 'Количество должно быть кратно', choose: 'Выбрать', unavailable: 'Недоступно',
  insufficientStock: 'Нужного количества сейчас нет в наличии.',
  closeConfirmation: 'Закрыть подтверждение', explicitConfirmation: 'Явное подтверждение',
  addToCart: 'Добавить товар в корзину?', quantity: 'Количество', total: 'Итого',
  adjustQuantity: 'Изменить количество', decreaseQuantity: 'Уменьшить количество', increaseQuantity: 'Увеличить количество',
  invalidQuantity: 'Введите положительное целое количество.', quantityStock: 'Количество превышает показанный остаток.', quantityMultiple: 'Количество должно быть кратно указанной упаковке.',
  stockRechecked: 'Сервер повторно проверит остаток с учётом корзины.',
  quantityLocked: 'Количество зафиксировано для безопасного повтора запроса.',
  retryNote: 'Повторная попытка использует то же подтверждение.', cancel: 'Отмена',
  adding: 'Добавляю…', retry: 'Повторить', yesAdd: 'Да, добавить',
  home: 'Главная', loadingCart: 'Загружаю корзину…', emptyCart: 'В корзине пока нет товаров.',
  backCatalog: 'Вернуться в каталог',
  demoQuery: 'Нужен автомат 3P C16, 10 kA, 8 штук. Если нет — совместимый аналог.',
}

const kk: typeof ru = {
  cart: 'Себет',
  assistant: 'EKT көмекшісі', assistantSubtitle: 'Каталог және сатып алу шарттары', closeChat: 'Чатты жабу',
  greeting: 'Сәлеметсіз бе! Тауарды артикул немесе сипаттамалары бойынша табуға, қалдығын тексеруге және баламаларын түсіндіруге көмектесемін. Жеткізу мен төлем туралы да жауап беремін.',
  suggestionsHeading: 'Мысалы, сұраңыз:', productSuggestion: 'Автоматты таңдау', termsSuggestion: 'Төлем шарттары',
  termsQuery: 'Төлем шарттары қандай?',
  you: 'Сіз', source: 'Шарттар көзі', noResults: 'Тауардың артикулын немесе сипаттамаларын нақтылаңыз.',
  searching: 'Каталогтан іздеп жатырмын', messageLabel: 'EKT көмекшісіне хабарлама',
  messagePlaceholder: 'Мысалы: 3P C16, 10 kA автоматы, 8 дана керек',
  demo: 'Мысал', send: 'Жіберу', openChat: 'EKT көмекшісімен чатты ашу', askAssistant: 'Көмекшіден сұрау',
  languageLabel: 'Қарым-қатынас тілі',
  readingMode: 'Нашар көретіндерге', modeEnabled: 'Қосулы', modeDisabled: 'Өшірулі',
  conversationHistory: 'Хат алмасу тарихы', chatHistory: 'Чаттар тарихы', newChat: 'Жаңа чат',
  chatNavigation: 'Чаттарды басқару', dialogues: 'Диалогтар', untitledChat: 'Жаңа диалог', currentChat: 'Ағымдағы', backToChat: 'Чатқа оралу',
  historyLifetime: 'Тарих пен жазбалар осы браузерде сақталады. Ортақ құрылғыда сөйлесуден кейін оларды жойыңыз. Төлем деректерін енгізбеңіз.',
  historyConflict: 'Тарих басқа бетте жаңартылды.', refreshHistory: 'Тарихты жаңарту',
  refreshHistoryWarning: 'Жаңарту ағымдағы сақталмаған жазбаны жояды.',
  historyStorageError: 'Тарихты сақтау немесе сақталған деректерді оқу мүмкін болмады. Браузер баптаулары мен бос орынды тексеріңіз. Бетті жаңартқанда өзгерістер жоғалуы мүмкін; жою расталмады.',
  restoredHistoryNote: 'Бұл сақталған хат алмасу, бағалар мен қалдықтар ескіруі мүмкін. Бет жаңартылғаннан кейін артикулды немесе сипаттамаларды қайталаңыз: іздеу контексті жаңадан басталады.',
  deleteChat: 'Чатты жою', clearHistory: 'Тарихты тазалау', deleteConfirm: 'Жою',
  deleteChatQuestion: 'Осы чатты жою керек пе?', clearHistoryQuestion: 'Барлық чат тарихын жою керек пе?',
  deleteHistoryWarning: 'Хат алмасу мен жазбалар осы браузерден қайтарусыз жойылады. Себет өзгермейді. Бұл әрекет сервердегі деректерді жоймайды.',
  previousResult: 'Алдыңғы нәтиже', previousResultNote: 'Алдыңғы жауаптағы деректер. Сатып алу үшін тауарды жаңа сұраумен тексеріңіз.',
  shortQuery: 'Кемінде 5 таңба енгізіңіз: артикул, тауар атауы немесе сатып алу шарттары туралы сұрақ.',
  requestFailed: 'Сұрауды орындау мүмкін болмады. Қайталап көріңіз.',
  searchTimeout: 'Жауап уақытында келмеді. Сұрақ хат алмасуда сақталды. Қайталап көріңіз.',
  retryQuestion: 'Сұрақты қайталау',
  requestTimeout: 'Жауап уақытында келмеді. Тауар себетке қосылып қойған болуы мүмкін. Қосу сұрауын тексеріңіз; қайталау тауарды екі рет қоспайды.',
  serverUnavailable: 'Көмекші сервері қолжетімсіз. Интернет қосылымын тексеріп, қайталап көріңіз.',
  pendingCart: 'Тауар қосылып жатыр. Терезені жабу сұрауды тоқтатпайды. Сервер растағаннан кейін себет ашылады.',
  cartNeedsReview: 'Тауардың қосылғанын растау мүмкін болмады. Қайталау алдында сұрауды тексеріңіз.',
  reviewCartRequest: 'Қосу сұрауын тексеру', hideRequest: 'Терезені жасыру',
  resolveCartFirst: 'Басқа тауарды қоспас бұрын аяқталмаған қосу сұрауын тексеріңіз.',
  exactMatch: 'Дәл сәйкестік', compatible: 'Ұсынылған балама', inStock: 'Қоймада', piece: 'дана',
  productEvidence: 'Сипаттамалар мен қалдық', catalogEvidenceSource: 'Каталог жауабындағы деректер. Көрсетілмеген сипаттамаларды нақтылау қажет.',
  productBrand: 'Бренд', productPoles: 'Полюстер саны', productCurve: 'Іске қосылу сипаттамасы', productCurrent: 'Номиналды ток', productCapacity: 'Ажырату қабілеті', productPack: 'Қаптама еселігі',
  catalogProperties: 'Каталог қасиеттері', notProvided: 'Көрсетілмеген', propertyYes: 'Иә', propertyNo: 'Жоқ', unsupportedProperty: 'Мән форматына қолдау көрсетілмейді.',
  noSpecifications: 'Техникалық сипаттамалар берілмеген.', warehouseStock: 'Қоймалардағы қалдық', noWarehouseStock: 'Қоймалар бойынша деректер берілмеген.', unnamedWarehouse: 'Атауы жоқ қойма',
  productCertificates: 'Сертификаттар', noCertificates: 'Каталог жауабында сертификаттар берілмеген.', invalidCertificates: 'Кейбір сілтемелер қолжетімсіз немесе қате.', unnamedCertificate: 'Құжат', opensNewTab: 'жаңа бетте',
  whyAlternative: 'Балама неге ұсынылды', missingReason: 'Баламаның негіздемесі берілмеген. Үйлесімділікті нақтылаңыз.', compatibilityCaution: 'Көрсетілген параметрлердің сәйкестігі толық өзара алмастыруға кепілдік бермейді.', technicalWarning: 'Сипаттамаларды тексеру қажет',
  multipleOf: 'Саны мына мәнге еселі болуы тиіс:', choose: 'Таңдау', unavailable: 'Қолжетімсіз',
  insufficientStock: 'Қажетті мөлшер қазір қоймада жоқ.',
  closeConfirmation: 'Растауды жабу', explicitConfirmation: 'Айқын растау',
  addToCart: 'Тауарды себетке қосу керек пе?', quantity: 'Саны', total: 'Барлығы',
  adjustQuantity: 'Санын өзгерту', decreaseQuantity: 'Санын азайту', increaseQuantity: 'Санын көбейту',
  invalidQuantity: 'Оң бүтін сан енгізіңіз.', quantityStock: 'Саны көрсетілген қалдықтан артық.', quantityMultiple: 'Саны көрсетілген қаптамаға еселі болуы тиіс.',
  stockRechecked: 'Сервер себетті ескеріп, қалдықты қайта тексереді.',
  quantityLocked: 'Сұрауды қауіпсіз қайталау үшін саны бекітілді.',
  retryNote: 'Қайталау сол растауды пайдаланады.', cancel: 'Бас тарту',
  adding: 'Қосылып жатыр…', retry: 'Қайталау', yesAdd: 'Иә, қосу',
  home: 'Басты бет', loadingCart: 'Себет жүктелуде…', emptyCart: 'Себетте әзірге тауар жоқ.',
  backCatalog: 'Каталогқа оралу',
  demoQuery: '3P C16, 10 kA автоматы, 8 дана керек. Болмаса, үйлесімді баламасын ұсыныңыз.',
}

export type UiText = typeof ru
export const translations: Record<Language, UiText> = { ru, kk }

export function backendSearchQuery(query: string, language: Language | null): string {
  if (language !== 'kk') return query
  // The current search parser recognizes Russian quantity and payment keywords only.
  return query
    .replace(/(\d+)\s*дана(?=$|[^\p{L}])/giu, '$1 шт.')
    .replace(/төлем/giu, 'оплата')
}

export function storedLanguage(): Language | null {
  try {
    const saved = window.localStorage.getItem('ekt-ui-language')
    return saved === 'kk' || saved === 'ru' ? saved : null
  } catch {
    return null
  }
}
