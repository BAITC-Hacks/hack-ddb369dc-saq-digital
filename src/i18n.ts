export type Language = 'ru' | 'kk'

const ru = {
  cart: 'Корзина',
  assistant: 'Помощник EKT', assistantSubtitle: 'Каталог и условия покупки', closeChat: 'Свернуть чат',
  greeting: 'Здравствуйте! Подберу товар по артикулу или характеристикам, проверю остатки и объясню аналоги. Могу ответить про доставку и оплату.',
  you: 'Вы', source: 'Источник условий', noResults: 'Уточните артикул или характеристики товара.',
  searching: 'Ищу по каталогу', messageLabel: 'Сообщение помощнику EKT',
  messagePlaceholder: 'Например: нужен автомат 3P C16, 10 kA, 8 штук',
  demo: 'Demo', send: 'Отправить', openChat: 'Открыть чат с помощником EKT', askAssistant: 'Спросить помощника',
  shortQuery: 'Укажите артикул, название товара или вопрос об условиях покупки.',
  requestFailed: 'Не удалось выполнить запрос. Повторите попытку.',
  exactMatch: 'Точное совпадение', compatible: 'Совместимый аналог', inStock: 'В наличии', piece: 'шт.',
  multipleOf: 'Количество должно быть кратно', choose: 'Выбрать', unavailable: 'Недоступно',
  insufficientStock: 'Нужного количества сейчас нет в наличии.',
  closeConfirmation: 'Закрыть подтверждение', explicitConfirmation: 'Явное подтверждение',
  addToCart: 'Добавить товар в корзину?', quantity: 'Количество', total: 'Итого',
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
  you: 'Сіз', source: 'Шарттар көзі', noResults: 'Тауардың артикулын немесе сипаттамаларын нақтылаңыз.',
  searching: 'Каталогтан іздеп жатырмын', messageLabel: 'EKT көмекшісіне хабарлама',
  messagePlaceholder: 'Мысалы: 3P C16, 10 kA автоматы, 8 дана керек',
  demo: 'Мысал', send: 'Жіберу', openChat: 'EKT көмекшісімен чатты ашу', askAssistant: 'Көмекшіден сұрау',
  shortQuery: 'Артикулды, тауар атауын немесе сатып алу шарттары туралы сұрақты жазыңыз.',
  requestFailed: 'Сұрауды орындау мүмкін болмады. Қайталап көріңіз.',
  exactMatch: 'Дәл сәйкестік', compatible: 'Үйлесімді балама', inStock: 'Қоймада', piece: 'дана',
  multipleOf: 'Саны мына мәнге еселі болуы тиіс:', choose: 'Таңдау', unavailable: 'Қолжетімсіз',
  insufficientStock: 'Қажетті мөлшер қазір қоймада жоқ.',
  closeConfirmation: 'Растауды жабу', explicitConfirmation: 'Айқын растау',
  addToCart: 'Тауарды себетке қосу керек пе?', quantity: 'Саны', total: 'Барлығы',
  retryNote: 'Қайталау сол растауды пайдаланады.', cancel: 'Бас тарту',
  adding: 'Қосылып жатыр…', retry: 'Қайталау', yesAdd: 'Иә, қосу',
  home: 'Басты бет', loadingCart: 'Себет жүктелуде…', emptyCart: 'Себетте әзірге тауар жоқ.',
  backCatalog: 'Каталогқа оралу',
  demoQuery: '3P C16, 10 kA автоматы, 8 дана (8 шт.) керек. Болмаса, үйлесімді баламасын ұсыныңыз.',
}

export type UiText = typeof ru
export const translations: Record<Language, UiText> = { ru, kk }

export function storedLanguage(): Language | null {
  try {
    const saved = window.localStorage.getItem('ekt-ui-language')
    return saved === 'kk' || saved === 'ru' ? saved : null
  } catch {
    return null
  }
}
