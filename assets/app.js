const state = {
  lang: "uk",
  category: "all",
  site: null,
  products: []
};

const fallbackLang = "uk";

const getValue = (value, lang = state.lang) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value[lang] || value[fallbackLang] || Object.values(value)[0] || "";
  }
  return value ?? "";
};

const getPath = (object, path) => path.split(".").reduce((current, key) => current?.[key], object);

const setLanguage = (lang) => {
  state.lang = lang;
  document.documentElement.lang = lang;
  localStorage.setItem("viteh.lang", lang);
  render();
};

const loadJson = async (path) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
};

const renderTranslations = () => {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const value = getPath(state.site.i18n, node.dataset.i18n);
    node.textContent = getValue(value);
  });
  document.title = getValue(state.site.meta.title);
};

const renderLanguageSelect = () => {
  const select = document.getElementById("languageSelect");
  select.innerHTML = "";
  state.site.languages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.label;
    option.selected = language.code === state.lang;
    select.append(option);
  });
};

const renderFilters = () => {
  const filters = document.getElementById("categoryFilters");
  const categories = [
    { id: "all", label: state.site.i18n.categories.all },
    ...state.site.categories
  ];
  filters.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = `filter${state.category === category.id ? " active" : ""}`;
    button.type = "button";
    button.textContent = getValue(category.label);
    button.addEventListener("click", () => {
      state.category = category.id;
      renderProducts();
      renderFilters();
    });
    filters.append(button);
  });
};

const renderProducts = () => {
  const grid = document.getElementById("productGrid");
  const products = state.category === "all"
    ? state.products
    : state.products.filter((product) => product.category === state.category);

  grid.innerHTML = "";
  products.forEach((product) => {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <img src="${product.image}" alt="${getValue(product.title)}">
      <div class="product-body">
        <div class="product-meta">
          <span class="tag">${getValue(state.site.categories.find((category) => category.id === product.category)?.label || product.category)}</span>
          <span class="tag">${getValue(product.status)}</span>
        </div>
        <h3>${getValue(product.title)}</h3>
        <p>${getValue(product.summary)}</p>
        <div class="price">${getValue(product.price)}</div>
      </div>
    `;
    grid.append(card);
  });
};

const renderContact = () => {
  const container = document.getElementById("contactActions");
  container.innerHTML = "";
  state.site.contacts.forEach((contact) => {
    const link = document.createElement("a");
    link.href = contact.href;
    link.textContent = getValue(contact.label);
    container.append(link);
  });
};

const render = () => {
  renderLanguageSelect();
  renderTranslations();
  renderFilters();
  renderProducts();
  renderContact();
};

const init = async () => {
  const [site, products] = await Promise.all([
    loadJson("data/site.json"),
    loadJson("data/products.json")
  ]);

  state.site = site;
  state.products = products;

  const savedLang = localStorage.getItem("viteh.lang");
  state.lang = site.languages.some((language) => language.code === savedLang)
    ? savedLang
    : (navigator.language || "").slice(0, 2);
  if (!site.languages.some((language) => language.code === state.lang)) {
    state.lang = fallbackLang;
  }

  document.getElementById("languageSelect").addEventListener("change", (event) => {
    setLanguage(event.target.value);
  });

  render();
};

init().catch((error) => {
  document.body.innerHTML = `<main class="section"><h1>ViTeh</h1><p>${error.message}</p></main>`;
});
