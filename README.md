# Photo Review System

Веб-приложение для модерации фото:
- пользователь загружает фото и отслеживает статус;
- администратор проверяет каждое фото отдельно, оставляет комментарии;
- есть загрузка оригинала для одобренного фото;
- есть журнал активности пользователей.

## Для пользователя

### 1. Отправка фото
1. Откройте главную страницу сайта.
2. Нажмите `Отправить фото`.
3. Заполните обязательные поля (`Имя`, `Район`, `Email`).
4. Загрузите одно или несколько фото.
5. Нажмите `Отправить на проверку`.

Требования к фото:
- минимальная ширина: `2000px`;
- минимальный размер файла: `250 KB`;
- форматы: `JPG`, `PNG`, `WEBP`.

### 2. Проверка статуса
1. Откройте вкладку `Проверить статус`.
2. Введите ваш `Email`.
3. Нажмите `Проверить`.
4. При наличии профиля используйте кнопку перехода в личный кабинет.

### 3. Личный кабинет
URL: `/user/<ваш_email>`

В кабинете можно:
- смотреть статусы фото и комментарии администратора;
- загружать новые фото;
- загружать оригинал для одобренного фото;
- удалять фото и оригинал.

## Для администратора

### 1. Вход в админку
- Доступ только через URL: `/admin`.
- Логин/пароль задаются переменными:
  - `PHOTO_REVIEW_ADMIN_USER`
  - `PHOTO_REVIEW_ADMIN_PASS`

### 2. Модерация
- Статус выставляется по каждому фото отдельно (`Одобрить` / `Отклонить`).
- Комментарий сохраняется для конкретного фото.
- Есть фильтры по статусам и раздел `Активность пользователей`.

## Для DevOps

### 1. Расположение проекта
Прод-сервер:
- путь: `/var/www/html/gibdd90.multfilm.tatar`
- домен: `https://gibdd90.multfilm.tatar`

### 2. Конфигурация окружения
Файл `.env` хранится локально на сервере и не коммитится.

Шаблон:
```bash
cp .env.example .env
```

Минимальные обязательные переменные:
- `PHOTO_REVIEW_SECRET_KEY`
- `PHOTO_REVIEW_ADMIN_USER`
- `PHOTO_REVIEW_ADMIN_PASS`
- `PHOTO_REVIEW_BASE_URL`

Для email-уведомлений:
- `PHOTO_REVIEW_SMTP_HOST`
- `PHOTO_REVIEW_SMTP_PORT`
- `PHOTO_REVIEW_SMTP_USER`
- `PHOTO_REVIEW_SMTP_PASS`
- `PHOTO_REVIEW_SMTP_FROM`
- `PHOTO_REVIEW_SMTP_USE_TLS`
- `PHOTO_REVIEW_SMTP_USE_SSL`
- `PHOTO_REVIEW_ADMIN_NOTIFY_EMAIL`

### 3. Docker запуск
```bash
cd /var/www/html/gibdd90.multfilm.tatar
docker-compose up -d --build
```

Проверка:
```bash
docker-compose ps
docker-compose logs -f
```

### 4. Перезапуск контейнера
Мягкий перезапуск:
```bash
docker-compose restart
```

Полный перезапуск с пересборкой:
```bash
docker-compose down
docker-compose up -d --build --force-recreate
```

### 5. Обновление приложения
```bash
cd /var/www/html/gibdd90.multfilm.tatar
git pull
docker-compose down
docker-compose up -d --build
```


### 6. Данные и бэкап
Данные приложения хранятся в:
- `/var/www/html/gibdd90.multfilm.tatar/data`

Содержимое:
- `photoreview.db`
- `uploads/`

Бэкап:
```bash
tar -czf /root/photoreview-backup-$(date +%F).tar.gz /var/www/html/gibdd90.multfilm.tatar/data
```
