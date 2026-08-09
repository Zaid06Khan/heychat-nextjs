export const LANGUAGES = {
  en: { name: 'English', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
  es: { name: 'Español', dir: 'ltr' },
  pt: { name: 'Português', dir: 'ltr' },
  ar: { name: 'العربية', dir: 'rtl' },
  ur: { name: 'اردو', dir: 'rtl' },
  zh: { name: '中文', dir: 'ltr' },
  ja: { name: '日本語', dir: 'ltr' },
  sw: { name: 'Kiswahili', dir: 'ltr' },
  ha: { name: 'Hausa', dir: 'ltr' },
};

const translations = {
  en: {
    'nav.chats': 'Chats', 'nav.contacts': 'Contacts', 'nav.profile': 'Profile', 'nav.settings': 'Settings',
    'common.search': 'Search', 'common.send': 'Send', 'common.save': 'Save', 'common.cancel': 'Cancel', 'common.back': 'Back', 'common.close': 'Close',
    'landing.createAccount': 'Create Account', 'landing.login': 'Log In',
    'login.title': 'Welcome back', 'login.username': 'Username', 'login.password': 'Password', 'login.submit': 'Log In',
    'register.title': 'Create your account', 'register.submit': 'Create Account',
    'settings.title': 'Settings', 'settings.privacy': 'Privacy', 'settings.language': 'Language', 'settings.logout': 'Log out', 'settings.deleteAccount': 'Delete account permanently', 'settings.suggestions': 'Discoverability', 'settings.optOut': 'Opt out of being suggested to others',
    'profile.title': 'Profile', 'profile.save': 'Save Changes', 'profile.shareProfile': 'Share Profile',
    'chat.encrypted': 'Encrypted in transit', 'chat.report': 'Report', 'chat.block': 'Block',
    'contacts.title': 'Contacts',
    'report.title': 'Report User', 'report.submit': 'Submit Report', 'report.blockAlso': 'Also block this user',
  },
  ru: {
    'nav.chats': 'Чаты', 'nav.contacts': 'Контакты', 'nav.profile': 'Профиль', 'nav.settings': 'Настройки',
    'common.search': 'Поиск', 'common.send': 'Отправить', 'common.save': 'Сохранить', 'common.cancel': 'Отмена', 'common.back': 'Назад', 'common.close': 'Закрыть',
    'landing.createAccount': 'Создать аккаунт', 'landing.login': 'Войти',
    'login.title': 'С возвращением', 'login.username': 'Имя пользователя', 'login.password': 'Пароль', 'login.submit': 'Войти',
    'register.title': 'Создайте аккаунт', 'register.submit': 'Создать аккаунт',
    'settings.title': 'Настройки', 'settings.privacy': 'Конфиденциальность', 'settings.language': 'Язык', 'settings.logout': 'Выйти', 'settings.deleteAccount': 'Удалить аккаунт навсегда', 'settings.suggestions': 'Обнаружение', 'settings.optOut': 'Отказаться от рекомендаций',
    'profile.title': 'Профиль', 'profile.save': 'Сохранить изменения', 'profile.shareProfile': 'Поделиться профилем',
    'chat.encrypted': 'Шифрование при передаче', 'chat.report': 'Пожаловаться', 'chat.block': 'Заблокировать',
    'contacts.title': 'Контакты',
    'report.title': 'Пожаловаться', 'report.submit': 'Отправить жалобу', 'report.blockAlso': 'Также заблокировать',
  },
  es: {
    'nav.chats': 'Chats', 'nav.contacts': 'Contactos', 'nav.profile': 'Perfil', 'nav.settings': 'Ajustes',
    'common.search': 'Buscar', 'common.send': 'Enviar', 'common.save': 'Guardar', 'common.cancel': 'Cancelar', 'common.back': 'Atrás', 'common.close': 'Cerrar',
    'landing.createAccount': 'Crear cuenta', 'landing.login': 'Iniciar sesión',
    'login.title': 'Bienvenido de nuevo', 'login.username': 'Nombre de usuario', 'login.password': 'Contraseña', 'login.submit': 'Iniciar sesión',
    'register.title': 'Crea tu cuenta', 'register.submit': 'Crear cuenta',
    'settings.title': 'Ajustes', 'settings.privacy': 'Privacidad', 'settings.language': 'Idioma', 'settings.logout': 'Cerrar sesión', 'settings.deleteAccount': 'Eliminar cuenta permanentemente', 'settings.suggestions': 'Descubribilidad', 'settings.optOut': 'Excluirse de sugerencias',
    'profile.title': 'Perfil', 'profile.save': 'Guardar cambios', 'profile.shareProfile': 'Compartir perfil',
    'chat.encrypted': 'Cifrado en tránsito', 'chat.report': 'Reportar', 'chat.block': 'Bloquear',
    'contacts.title': 'Contactos',
    'report.title': 'Reportar usuario', 'report.submit': 'Enviar reporte', 'report.blockAlso': 'También bloquear',
  },
  pt: {
    'nav.chats': 'Conversas', 'nav.contacts': 'Contatos', 'nav.profile': 'Perfil', 'nav.settings': 'Configurações',
    'common.search': 'Pesquisar', 'common.send': 'Enviar', 'common.save': 'Salvar', 'common.cancel': 'Cancelar', 'common.back': 'Voltar', 'common.close': 'Fechar',
    'landing.createAccount': 'Criar conta', 'landing.login': 'Entrar',
    'login.title': 'Bem-vindo de volta', 'login.username': 'Nome de usuário', 'login.password': 'Senha', 'login.submit': 'Entrar',
    'register.title': 'Crie sua conta', 'register.submit': 'Criar conta',
    'settings.title': 'Configurações', 'settings.privacy': 'Privacidade', 'settings.language': 'Idioma', 'settings.logout': 'Sair', 'settings.deleteAccount': 'Excluir conta permanentemente', 'settings.suggestions': 'Descobribilidade', 'settings.optOut': 'Excluir-se de sugestões',
    'profile.title': 'Perfil', 'profile.save': 'Salvar alterações', 'profile.shareProfile': 'Compartilhar perfil',
    'chat.encrypted': 'Criptografado em trânsito', 'chat.report': 'Denunciar', 'chat.block': 'Bloquear',
    'contacts.title': 'Contatos',
    'report.title': 'Denunciar usuário', 'report.submit': 'Enviar denúncia', 'report.blockAlso': 'Também bloquear',
  },
  ar: {
    'nav.chats': 'المحادثات', 'nav.contacts': 'جهات الاتصال', 'nav.profile': 'الملف الشخصي', 'nav.settings': 'الإعدادات',
    'common.search': 'بحث', 'common.send': 'إرسال', 'common.save': 'حفظ', 'common.cancel': 'إلغاء', 'common.back': 'رجوع', 'common.close': 'إغلاق',
    'landing.createAccount': 'إنشاء حساب', 'landing.login': 'تسجيل الدخول',
    'login.title': 'مرحباً بعودتك', 'login.username': 'اسم المستخدم', 'login.password': 'كلمة المرور', 'login.submit': 'تسجيل الدخول',
    'register.title': 'أنشئ حسابك', 'register.submit': 'إنشاء حساب',
    'settings.title': 'الإعدادات', 'settings.privacy': 'الخصوصية', 'settings.language': 'اللغة', 'settings.logout': 'تسجيل الخروج', 'settings.deleteAccount': 'حذف الحساب نهائياً', 'settings.suggestions': 'الظهور', 'settings.optOut': 'إلغاء الظهور في الاقتراحات',
    'profile.title': 'الملف الشخصي', 'profile.save': 'حفظ التغييرات', 'profile.shareProfile': 'مشاركة الملف الشخصي',
    'chat.encrypted': 'مشفر أثناء النقل', 'chat.report': 'إبلاغ', 'chat.block': 'حظر',
    'contacts.title': 'جهات الاتصال',
    'report.title': 'الإبلاغ عن مستخدم', 'report.submit': 'إرسال البلاغ', 'report.blockAlso': 'وحظر هذا المستخدم',
  },
  ur: {
    'nav.chats': 'چیٹس', 'nav.contacts': 'رابطے', 'nav.profile': 'پروفائل', 'nav.settings': 'ترتیبات',
    'common.search': 'تلاش', 'common.send': 'بھیجیں', 'common.save': 'محفوظ کریں', 'common.cancel': 'منسوخ', 'common.back': 'واپس', 'common.close': 'بند کریں',
    'landing.createAccount': 'اکاؤنٹ بنائیں', 'landing.login': 'لاگ ان',
    'login.title': 'خوش آمدید', 'login.username': 'صارف نامہ', 'login.password': 'پاس ورڈ', 'login.submit': 'لاگ ان',
    'register.title': 'اپنا اکاؤنٹ بنائیں', 'register.submit': 'اکاؤنٹ بنائیں',
    'settings.title': 'ترتیبات', 'settings.privacy': 'پرائیویسی', 'settings.language': 'زبان', 'settings.logout': 'لاگ آؤٹ', 'settings.deleteAccount': 'اکاؤنٹ مستقل حذف کریں', 'settings.suggestions': 'دکھائی دینا', 'settings.optOut': 'تجاویز سے خارج ہوں',
    'profile.title': 'پروفائل', 'profile.save': 'تبدیلیاں محفوظ کریں', 'profile.shareProfile': 'پروفائل شیئر کریں',
    'chat.encrypted': 'ٹرانزٹ میں خفیہ کاری', 'chat.report': 'شکایت', 'chat.block': 'بلاک',
    'contacts.title': 'رابطے',
    'report.title': 'صارف پر شکایت', 'report.submit': 'شکایت بھیجیں', 'report.blockAlso': 'صارف کو بلاک کریں',
  },
  zh: {
    'nav.chats': '聊天', 'nav.contacts': '联系人', 'nav.profile': '个人资料', 'nav.settings': '设置',
    'common.search': '搜索', 'common.send': '发送', 'common.save': '保存', 'common.cancel': '取消', 'common.back': '返回', 'common.close': '关闭',
    'landing.createAccount': '创建账户', 'landing.login': '登录',
    'login.title': '欢迎回来', 'login.username': '用户名', 'login.password': '密码', 'login.submit': '登录',
    'register.title': '创建您的账户', 'register.submit': '创建账户',
    'settings.title': '设置', 'settings.privacy': '隐私', 'settings.language': '语言', 'settings.logout': '退出登录', 'settings.deleteAccount': '永久删除账户', 'settings.suggestions': '可发现性', 'settings.optOut': '退出被推荐',
    'profile.title': '个人资料', 'profile.save': '保存更改', 'profile.shareProfile': '分享个人资料',
    'chat.encrypted': '传输加密', 'chat.report': '举报', 'chat.block': '拉黑',
    'contacts.title': '联系人',
    'report.title': '举报用户', 'report.submit': '提交举报', 'report.blockAlso': '同时拉黑',
  },
  ja: {
    'nav.chats': 'チャット', 'nav.contacts': '連絡先', 'nav.profile': 'プロフィール', 'nav.settings': '設定',
    'common.search': '検索', 'common.send': '送信', 'common.save': '保存', 'common.cancel': 'キャンセル', 'common.back': '戻る', 'common.close': '閉じる',
    'landing.createAccount': 'アカウント作成', 'landing.login': 'ログイン',
    'login.title': 'おかえりなさい', 'login.username': 'ユーザー名', 'login.password': 'パスワード', 'login.submit': 'ログイン',
    'register.title': 'アカウントを作成', 'register.submit': 'アカウント作成',
    'settings.title': '設定', 'settings.privacy': 'プライバシー', 'settings.language': '言語', 'settings.logout': 'ログアウト', 'settings.deleteAccount': 'アカウントを完全に削除', 'settings.suggestions': '発見可能性', 'settings.optOut': 'おすすめから外れる',
    'profile.title': 'プロフィール', 'profile.save': '変更を保存', 'profile.shareProfile': 'プロフィールを共有',
    'chat.encrypted': '通信は暗号化', 'chat.report': '報告', 'chat.block': 'ブロック',
    'contacts.title': '連絡先',
    'report.title': 'ユーザーを報告', 'report.submit': '報告を送信', 'report.blockAlso': 'ユーザーをブロック',
  },
  sw: {
    'nav.chats': 'Soga', 'nav.contacts': 'Anwani', 'nav.profile': 'Wasifu', 'nav.settings': 'Mipangilio',
    'common.search': 'Tafuta', 'common.send': 'Tuma', 'common.save': 'Hifadhi', 'common.cancel': 'Ghairi', 'common.back': 'Rudi', 'common.close': 'Funga',
    'landing.createAccount': 'Fungua Akaunti', 'landing.login': 'Ingia',
    'login.title': 'Karibu tena', 'login.username': 'Jina la mtumiaji', 'login.password': 'Nenosiri', 'login.submit': 'Ingia',
    'register.title': 'Fungua akaunti yako', 'register.submit': 'Fungua Akaunti',
    'settings.title': 'Mipangilio', 'settings.privacy': 'Faragha', 'settings.language': 'Lugha', 'settings.logout': 'Toka', 'settings.deleteAccount': 'Futa akaunti kabisa', 'settings.suggestions': 'Kuonekana', 'settings.optOut': 'Ondoka katika mapendekezo',
    'profile.title': 'Wasifu', 'profile.save': 'Hifadhi mabadiliko', 'profile.shareProfile': 'Shiriki Wasifu',
    'chat.encrypted': 'Imesimbwa wakati wa usafirishaji', 'chat.report': 'Ripoti', 'chat.block': 'Zuzuia',
    'contacts.title': 'Anwani',
    'report.title': 'Ripoti mtumiaji', 'report.submit': 'Tuma ripoti', 'report.blockAlso': 'Pia zuzuia mtumiaji',
  },
  ha: {
    'nav.chats': 'Tattaunawa', 'nav.contacts': 'Lambobin', 'nav.profile': 'Bayanin', 'nav.settings': 'Saitoci',
    'common.search': 'Nemo', 'common.send': 'Aika', 'common.save': 'Ajiye', 'common.cancel': 'Soke', 'common.back': 'Koma', 'common.close': 'Rufe',
    'landing.createAccount': 'Kirkiri Asusun', 'landing.login': 'Shiga',
    'login.title': 'Barka da dawowa', 'login.username': 'Sunan mai amfani', 'login.password': 'Kalmar sirri', 'login.submit': 'Shiga',
    'register.title': 'Kirkiri asusunka', 'register.submit': 'Kirkiri Asusun',
    'settings.title': 'Saitoci', 'settings.privacy': 'Keɓantawa', 'settings.language': 'Yare', 'settings.logout': 'Fita', 'settings.deleteAccount': 'Goge asusun har abada', 'settings.suggestions': 'Gano', 'settings.optOut': 'Cire kai daga shawarwari',
    'profile.title': 'Bayanin', 'profile.save': 'Ajiye canje-canje', 'profile.shareProfile': 'Raba Bayanin',
    'chat.encrypted': 'An ɓoye yayin aikawa', 'chat.report': 'Bayar da rahoto', 'chat.block': 'Toka',
    'contacts.title': 'Lambobin',
    'report.title': 'Bayar da rahoton mai amfani', 'report.submit': 'Aika rahoto', 'report.blockAlso': 'Kuma toka mai amfani',
  },
};

export function getLanguage() {
  try {
    const session = JSON.parse(localStorage.getItem('heychat_session') || '{}');
    return session.language || 'en';
  } catch {
    return 'en';
  }
}

export function setLanguage(lang) {
  const session = JSON.parse(localStorage.getItem('heychat_session') || '{}');
  session.language = lang;
  localStorage.setItem('heychat_session', JSON.stringify(session));
}

export function t(key) {
  const lang = getLanguage();
  return translations[lang]?.[key] || translations.en[key] || key;
}

export function isRTL() {
  return LANGUAGES[getLanguage()]?.dir === 'rtl';
}

export function applyDirection() {
  document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
}