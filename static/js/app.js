/*
 * Service Desk — клиентское Vue-приложение.
 *
 * Архитектурные принципы:
 *   1. Декларативный UI: используем v-bind / v-model / v-for / v-if,
 *      не трогаем DOM руками (нет querySelector / innerHTML на узлах с данными).
 *   2. Реактивность: фильтрация и поиск — через computed-свойства.
 *      При вводе текста Vue сам перерисует только нужные карточки.
 *   3. Безопасность: текстовые поля выводятся через интерполяцию [[ ]], которая
 *      по умолчанию экранирует HTML. v-html намеренно НЕ используется нигде.
 *   4. Изоляция: всё внутри createApp({...}).mount('#app'), глобально торчит
 *      только window.SD_CONFIG (минимальные настройки из шаблона).
 *
 * Разделители интерполяции изменены на [[ ]], чтобы не конфликтовать с
 * шаблонами Django ({{ }}).
 */

(function () {
    "use strict";

    const { createApp, reactive, computed, ref, onMounted } = Vue;

    const STATUS_OPTIONS = [
        { value: "new",         label: "Новая" },
        { value: "in_progress", label: "В работе" },
        { value: "waiting",     label: "Ожидает ответа" },
        { value: "resolved",    label: "Решена" },
        { value: "closed",      label: "Закрыта" }
    ];

    const PRIORITY_OPTIONS = [
        { value: "low",      label: "Низкий" },
        { value: "medium",   label: "Средний" },
        { value: "high",     label: "Высокий" },
        { value: "critical", label: "Критический" }
    ];

    const STORAGE_KEYS = {
        theme: "sd_theme",
        favorites: "sd_favorites",
        myTickets: "sd_my_tickets"
    };

    /**
     * Безопасное чтение из LocalStorage с парсингом JSON.
     * При любом сбое (квота, приватный режим, битый JSON) возвращает fallback.
     */
    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed == null ? fallback : parsed;
        } catch (err) {
            console.warn("LocalStorage read failed:", key, err);
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            console.warn("LocalStorage write failed:", key, err);
        }
    }

    /** Чтение CSRF-токена из cookie (на случай включения CSRF на сервере). */
    function getCookie(name) {
        const match = document.cookie.match(
            new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1") + "=([^;]*)")
        );
        return match ? decodeURIComponent(match[1]) : null;
    }

    /**
     * Обёртка над fetch с обработкой ошибок и таймаутом.
     * Возвращает Promise с распарсенным JSON или бросает Error с сообщением.
     */
    async function apiRequest(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
        if (options.body && !(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        const csrf = getCookie("csrftoken");
        if (csrf) headers["X-CSRFToken"] = csrf;

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
                credentials: "same-origin"
            });
            const isJson = (response.headers.get("content-type") || "").includes("application/json");
            const data = isJson ? await response.json() : null;
            if (!response.ok) {
                const err = new Error(
                    (data && data.detail) || `HTTP ${response.status} ${response.statusText}`
                );
                err.status = response.status;
                err.payload = data;
                throw err;
            }
            return data;
        } catch (err) {
            if (err.name === "AbortError") {
                const e = new Error("Сервер не отвечает (таймаут 15с).");
                e.status = 0;
                throw e;
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    const app = createApp({
        delimiters: ["[[", "]]"],

        setup() {
            // ---------- Состояние ----------
            const tickets = ref([]);
            const categories = ref([]);
            const loading = ref(true);
            const error = ref("");
            const search = ref("");
            const activeView = ref("all"); // 'all' | 'mine' | 'favorites'
            const theme = ref(window.SD_CONFIG.initialTheme);

            const filters = reactive({ status: "", priority: "", category: "" });

            const favorites = ref(readJson(STORAGE_KEYS.favorites, []));
            const myTickets = ref(readJson(STORAGE_KEYS.myTickets, []));
            const revealedPhones = ref(new Set());

            // Форма создания заявки
            const createModalOpen = ref(false);
            const submitting = ref(false);
            const form = reactive({
                title: "",
                description: "",
                category_id: "",
                priority: "medium",
                author_name: "",
                author_email: "",
                author_phone: ""
            });
            const formErrors = reactive({});
            const formGeneralError = ref("");

            // Подтверждение удаления
            const confirmDelete = ref(null);
            const deleting = ref(false);

            // Тосты
            const toasts = ref([]);
            let toastSeq = 0;
            function pushToast(message, type = "info", ttl = 3500) {
                const id = ++toastSeq;
                toasts.value.push({ id, message, type });
                setTimeout(() => {
                    toasts.value = toasts.value.filter(t => t.id !== id);
                }, ttl);
            }

            // ---------- Загрузка данных ----------
            async function loadTickets() {
                loading.value = true;
                error.value = "";
                try {
                    const [ticketsData, categoriesData] = await Promise.all([
                        apiRequest(window.SD_CONFIG.apiBase + "tickets/"),
                        apiRequest(window.SD_CONFIG.apiBase + "categories/")
                    ]);
                    tickets.value = ticketsData.results || [];
                    categories.value = categoriesData.results || [];
                } catch (err) {
                    console.error("loadTickets:", err);
                    error.value = err.message || "Неизвестная ошибка";
                } finally {
                    loading.value = false;
                }
            }

            // ---------- Реактивная фильтрация ----------
            const filteredTickets = computed(() => {
                let list = tickets.value;

                if (activeView.value === "mine") {
                    const mine = new Set(myTickets.value);
                    list = list.filter(t => mine.has(t.id));
                } else if (activeView.value === "favorites") {
                    const favs = new Set(favorites.value);
                    list = list.filter(t => favs.has(t.id));
                }

                if (filters.status)   list = list.filter(t => t.status === filters.status);
                if (filters.priority) list = list.filter(t => t.priority === filters.priority);
                if (filters.category) {
                    const catId = Number(filters.category);
                    list = list.filter(t => t.category && t.category.id === catId);
                }

                const q = search.value.trim().toLowerCase();
                if (q) {
                    list = list.filter(t => {
                        return (
                            t.title.toLowerCase().includes(q) ||
                            t.description.toLowerCase().includes(q) ||
                            t.author_name.toLowerCase().includes(q) ||
                            String(t.id).includes(q) ||
                            (t.category && t.category.name.toLowerCase().includes(q))
                        );
                    });
                }
                return list;
            });

            const stats = computed(() => {
                const base = { total: tickets.value.length, new: 0, in_progress: 0, resolved: 0 };
                for (const t of tickets.value) {
                    if (t.status === "new") base.new++;
                    else if (t.status === "in_progress") base.in_progress++;
                    else if (t.status === "resolved") base.resolved++;
                }
                return base;
            });

            const allCount       = computed(() => tickets.value.length);
            const myCount        = computed(() => myTickets.value.length);
            const favoritesCount = computed(() => favorites.value.length);

            const hasActiveFilters = computed(() =>
                Boolean(filters.status || filters.priority || filters.category || search.value)
            );

            function resetFilters() {
                filters.status = "";
                filters.priority = "";
                filters.category = "";
                search.value = "";
            }

            // ---------- Тема ----------
            function applyTheme(value) {
                theme.value = value;
                document.documentElement.dataset.theme = value;
                // тему храним в LocalStorage без JSON-обёртки, чтобы inline-скрипт
                // в шаблоне мог прочитать её одной строкой до загрузки Vue.
                try { localStorage.setItem(STORAGE_KEYS.theme, value); } catch (e) {}
            }
            function toggleTheme() {
                applyTheme(theme.value === "dark" ? "light" : "dark");
            }

            // ---------- Избранное / мои ----------
            function isFavorite(id) { return favorites.value.includes(id); }
            function toggleFavorite(id) {
                const idx = favorites.value.indexOf(id);
                if (idx === -1) favorites.value.push(id);
                else favorites.value.splice(idx, 1);
                writeJson(STORAGE_KEYS.favorites, favorites.value);
            }
            function isMyTicket(id) { return myTickets.value.includes(id); }
            function rememberMyTicket(id) {
                if (!myTickets.value.includes(id)) {
                    myTickets.value.push(id);
                    writeJson(STORAGE_KEYS.myTickets, myTickets.value);
                }
            }

            // ---------- Маскировка телефона ----------
            function maskPhone(phone) {
                if (!phone) return "";
                // оставляем первые 2 и последние 2 цифры, остальное — •
                const digits = phone.replace(/\D/g, "");
                if (digits.length < 6) return "•".repeat(digits.length);
                const visibleStart = digits.slice(0, 2);
                const visibleEnd = digits.slice(-2);
                const hidden = "•".repeat(Math.max(0, digits.length - 4));
                return `+${visibleStart} ${hidden} ${visibleEnd}`;
            }
            function isPhoneRevealed(id) { return revealedPhones.value.has(id); }
            function revealPhone(id) {
                revealedPhones.value.add(id);
                // принудительно триггерим реактивность Set
                revealedPhones.value = new Set(revealedPhones.value);
            }

            // ---------- Форматирование даты ----------
            const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
                day: "2-digit", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit"
            });
            function formatDate(iso) {
                if (!iso) return "";
                const d = new Date(iso);
                if (isNaN(d.getTime())) return "";
                return dateFormatter.format(d);
            }

            // ---------- Создание заявки ----------
            function openCreateModal() {
                Object.assign(form, {
                    title: "",
                    description: "",
                    category_id: categories.value[0] ? categories.value[0].id : "",
                    priority: "medium",
                    author_name: "",
                    author_email: "",
                    author_phone: ""
                });
                Object.keys(formErrors).forEach(k => delete formErrors[k]);
                formGeneralError.value = "";
                createModalOpen.value = true;
            }
            function closeCreateModal() {
                if (submitting.value) return;
                createModalOpen.value = false;
            }

            function validateForm() {
                Object.keys(formErrors).forEach(k => delete formErrors[k]);
                if (form.title.length < 5)        formErrors.title = "Минимум 5 символов.";
                else if (form.title.length > 160) formErrors.title = "Не более 160 символов.";

                if (form.description.length < 10) formErrors.description = "Опишите подробнее (минимум 10 символов).";

                if (!form.category_id) formErrors.category_id = "Выберите категорию.";

                if (form.author_name.length < 2) formErrors.author_name = "Введите имя.";

                const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRe.test(form.author_email)) formErrors.author_email = "Некорректный e-mail.";

                return Object.keys(formErrors).length === 0;
            }

            async function submitTicket() {
                formGeneralError.value = "";
                if (!validateForm()) return;
                submitting.value = true;
                try {
                    const created = await apiRequest(window.SD_CONFIG.apiBase + "tickets/", {
                        method: "POST",
                        body: JSON.stringify({
                            title: form.title,
                            description: form.description,
                            category_id: form.category_id,
                            priority: form.priority,
                            author_name: form.author_name,
                            author_email: form.author_email,
                            author_phone: form.author_phone
                        })
                    });
                    tickets.value = [created, ...tickets.value];
                    rememberMyTicket(created.id);
                    createModalOpen.value = false;
                    pushToast(`Заявка #${created.id} создана`, "success");
                } catch (err) {
                    console.error("submitTicket:", err);
                    if (err.payload && err.payload.errors) {
                        Object.assign(formErrors, err.payload.errors);
                        formGeneralError.value = "Проверьте корректность заполнения полей.";
                    } else {
                        formGeneralError.value = err.message || "Не удалось создать заявку.";
                    }
                } finally {
                    submitting.value = false;
                }
            }

            // ---------- Смена статуса ----------
            // Оптимистичное обновление: меняем статус в UI сразу, при ошибке
            // откатываем предыдущее значение и показываем toast.
            async function changeStatus(ticket, newStatus) {
                if (!ticket || ticket.status === newStatus) return;
                const previous = ticket.status;
                const previousLabel = ticket.status_label;
                const opt = STATUS_OPTIONS.find(o => o.value === newStatus);
                ticket.status = newStatus;
                ticket.status_label = opt ? opt.label : newStatus;
                try {
                    const updated = await apiRequest(
                        window.SD_CONFIG.apiBase + "tickets/" + ticket.id + "/",
                        { method: "PATCH", body: JSON.stringify({ status: newStatus }) }
                    );
                    // Синхронизируем поля с ответом сервера (например, updated_at).
                    Object.assign(ticket, updated);
                    pushToast(`Статус заявки #${ticket.id}: ${ticket.status_label}`, "success");
                } catch (err) {
                    console.error("changeStatus:", err);
                    ticket.status = previous;
                    ticket.status_label = previousLabel;
                    pushToast(err.message || "Не удалось сменить статус", "error");
                }
            }

            // ---------- Удаление ----------
            function askDelete(ticket) { confirmDelete.value = ticket; }
            function cancelDelete()    { if (!deleting.value) confirmDelete.value = null; }

            async function performDelete() {
                if (!confirmDelete.value) return;
                const id = confirmDelete.value.id;
                deleting.value = true;
                try {
                    await apiRequest(window.SD_CONFIG.apiBase + "tickets/" + id + "/", {
                        method: "DELETE"
                    });
                    tickets.value = tickets.value.filter(t => t.id !== id);
                    favorites.value = favorites.value.filter(x => x !== id);
                    myTickets.value = myTickets.value.filter(x => x !== id);
                    writeJson(STORAGE_KEYS.favorites, favorites.value);
                    writeJson(STORAGE_KEYS.myTickets, myTickets.value);
                    pushToast(`Заявка #${id} удалена`, "success");
                    confirmDelete.value = null;
                } catch (err) {
                    console.error("performDelete:", err);
                    pushToast(err.message || "Не удалось удалить", "error");
                } finally {
                    deleting.value = false;
                }
            }

            // ---------- Жизненный цикл ----------
            onMounted(() => {
                applyTheme(theme.value);
                loadTickets();
            });

            return {
                // данные
                tickets, categories, loading, error,
                search, filters, activeView,
                theme, favorites, myTickets,
                createModalOpen, submitting, form, formErrors, formGeneralError,
                confirmDelete, deleting, toasts,
                year: new Date().getFullYear(),
                statusOptions: STATUS_OPTIONS,
                priorityOptions: PRIORITY_OPTIONS,
                // computed
                filteredTickets, stats, allCount, myCount, favoritesCount, hasActiveFilters,
                // методы
                loadTickets, resetFilters,
                toggleTheme,
                isFavorite, toggleFavorite, isMyTicket,
                maskPhone, isPhoneRevealed, revealPhone,
                formatDate,
                openCreateModal, closeCreateModal, submitTicket,
                changeStatus,
                askDelete, cancelDelete, performDelete
            };
        }
    });

    app.mount("#app");
})();
