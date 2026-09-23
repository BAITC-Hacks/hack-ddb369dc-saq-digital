import configuration from '../config.json'

export type Language = 'ru' | 'kk'

const ru = {
  cart: 'Корзина',
  assistant: 'Помощник EKT', assistantSubtitle: 'Каталог и условия покупки', closeChat: 'Свернуть чат',
  greeting: 'Здравствуйте! Расскажу об ассортименте, помогу с подбором и отвечу на вопросы о товарах, корзине, доставке и оплате. Что вас интересует?',
  suggestionsHeading: 'Например, спросите:', productSuggestion: 'Подобрать автомат', termsSuggestion: 'Условия оплаты',
  termsQuery: 'Какие есть способы оплаты?',
  you: 'Вы', source: 'Источник условий', noResults: 'Нет подходящих позиций. Уточните артикул или характеристики товара.',
  searching: 'Готовлю ответ', messageLabel: 'Сообщение помощнику EKT', historyLabel: 'История диалога', interpreted: 'Распознано',
  messagePlaceholder: 'Например: нужен автомат 3P C16, 10 kA, 8 штук',
  demo: 'Demo', send: 'Отправить', openChat: 'Открыть чат с помощником EKT', askAssistant: 'Спросить помощника',
  languageLabel: 'Язык общения',
  shortQuery: 'Введите вопрос о сайте, артикул или характеристики товара.',
  requestFailed: 'Не удалось выполнить запрос. Повторите попытку.',
  requestTimeout: 'Ответ не получен вовремя. Если вы добавляли товар, он уже мог попасть в корзину. Проверьте добавление; повторная попытка не дублирует товар.',
  serverUnavailable: 'Сервер помощника недоступен. Проверьте подключение и повторите запрос.',
  pendingCart: 'Добавление продолжается. Закрытие окна не отменяет запрос. После подтверждения сервером откроется корзина.',
  cartNeedsReview: 'Не удалось подтвердить добавление. Проверьте запрос перед повторной попыткой.',
  reviewCartRequest: 'Проверить добавление', hideRequest: 'Скрыть окно',
  exactMatch: 'Точное совпадение', compatible: 'Совместимый аналог', inStock: 'В наличии', piece: 'шт.',
  multipleOf: 'Количество должно быть кратно', choose: 'Выбрать', unavailable: 'Недоступно',
  insufficientStock: 'Нужного количества сейчас нет в наличии.',
  remainingStock: 'Остаток', outOfStock: 'Нет в наличии', unspecified: 'Характеристики не указаны', certificate: 'Сертификат',
  closeConfirmation: 'Закрыть подтверждение', explicitConfirmation: 'Явное подтверждение',
  addToCart: 'Добавить товар в корзину?', quantity: 'Количество', total: 'Итого',
  retryNote: 'Повторная попытка использует то же подтверждение.', cancel: 'Отмена',
  adding: 'Добавляю…', retry: 'Повторить', yesAdd: 'Да, добавить',
  home: 'Главная', loadingCart: 'Загружаю корзину…', emptyCart: 'В корзине пока нет товаров.',
  backCatalog: 'Вернуться в каталог',
  product: 'Товар', price: 'Цена', lineTotal: 'Сумма', cartDisclaimer: 'Демонстрационная корзина. Оплата и оформление заказа не выполняются.',
  demoQuery: configuration.demoQuery,
}

const kk: typeof ru = {
  cart: 'Себет',
  assistant: 'EKT көмекшісі', assistantSubtitle: 'Каталог және сатып алу шарттары', closeChat: 'Чатты жабу',
  greeting: 'Сәлеметсіз бе! Тауарды артикул немесе сипаттамалары бойынша табуға, қалдығын тексеруге және баламаларын түсіндіруге көмектесемін. Жеткізу мен төлем туралы да жауап беремін.',
  suggestionsHeading: 'Мысалы, сұраңыз:', productSuggestion: 'Автоматты таңдау', termsSuggestion: 'Төлем шарттары',
  termsQuery: 'Төлем шарттары қандай?',
  you: 'Сіз', source: 'Шарттар көзі', noResults: 'Тауардың артикулын немесе сипаттамаларын нақтылаңыз.',
  searching: 'Жауап дайындап жатырмын', messageLabel: 'EKT көмекшісіне хабарлама', historyLabel: 'Диалог тарихы', interpreted: 'Анықталған параметрлер',
  messagePlaceholder: 'Мысалы: 3P C16, 10 kA автоматы, 8 дана керек',
  demo: 'Мысал', send: 'Жіберу', openChat: 'EKT көмекшісімен чатты ашу', askAssistant: 'Көмекшіден сұрау',
  languageLabel: 'Қарым-қатынас тілі',
  shortQuery: 'Сайт туралы сұрақты, артикулды немесе тауар сипаттамаларын енгізіңіз.',
  requestFailed: 'Сұрауды орындау мүмкін болмады. Қайталап көріңіз.',
  requestTimeout: 'Жауап уақытында келмеді. Тауар себетке қосылып қойған болуы мүмкін. Қосу сұрауын тексеріңіз; қайталау тауарды екі рет қоспайды.',
  serverUnavailable: 'Көмекші сервері қолжетімсіз. Интернет қосылымын тексеріп, қайталап көріңіз.',
  pendingCart: 'Тауар қосылып жатыр. Терезені жабу сұрауды тоқтатпайды. Сервер растағаннан кейін себет ашылады.',
  cartNeedsReview: 'Тауардың қосылғанын растау мүмкін болмады. Қайталау алдында сұрауды тексеріңіз.',
  reviewCartRequest: 'Қосу сұрауын тексеру', hideRequest: 'Терезені жасыру',
  exactMatch: 'Дәл сәйкестік', compatible: 'Үйлесімді балама', inStock: 'Қоймада', piece: 'дана',
  multipleOf: 'Саны мына мәнге еселі болуы тиіс:', choose: 'Таңдау', unavailable: 'Қолжетімсіз',
  insufficientStock: 'Қажетті мөлшер қазір қоймада жоқ.',
  remainingStock: 'Қалдық', outOfStock: 'Қоймада жоқ', unspecified: 'Сипаттамалар көрсетілмеген', certificate: 'Сертификат',
  closeConfirmation: 'Растауды жабу', explicitConfirmation: 'Айқын растау',
  addToCart: 'Тауарды себетке қосу керек пе?', quantity: 'Саны', total: 'Барлығы',
  retryNote: 'Қайталау сол растауды пайдаланады.', cancel: 'Бас тарту',
  adding: 'Қосылып жатыр…', retry: 'Қайталау', yesAdd: 'Иә, қосу',
  home: 'Басты бет', loadingCart: 'Себет жүктелуде…', emptyCart: 'Себетте әзірге тауар жоқ.',
  backCatalog: 'Каталогқа оралу',
  product: 'Тауар', price: 'Баға', lineTotal: 'Сома', cartDisclaimer: 'Демонстрациялық себет. Төлем мен тапсырысты рәсімдеу орындалмайды.',
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
