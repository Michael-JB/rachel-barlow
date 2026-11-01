// Renders both pages from content/*.json, which the CMS at /admin edits.

// The CMS stores image paths as "/images/x.jpg". Strip the leading slash so
// they resolve relative to the page, which also works when the site is served
// from a subpath (e.g. user.github.io/repo/).
const asset = (path) => (path || "").replace(/^\//, "");

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== ""));
  return node;
};

const metaLine = (work) =>
  [work.medium, work.dimensions, work.year].filter(Boolean).join(", ");

const caption = (work) => [
  el("span", { className: "caption-title", textContent: work.title }),
  el("span", { className: "caption-meta", textContent: metaLine(work) }),
];

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

function renderSite(site) {
  const page = document.body.dataset.pageTitle;
  document.title = page ? `${site.name} · ${page}` : site.name;
  document.querySelectorAll('[data-site="name"]').forEach((n) => (n.textContent = site.name));
  document.querySelector("[data-year]").textContent = new Date().getFullYear();

  const about = document.querySelector('[data-site="about"]');
  if (about) {
    about.replaceChildren(
      ...(site.about || "").split(/\n\s*\n/).map((p) => el("p", { textContent: p.trim() }))
    );
  }

  const links = document.querySelector(".contact-links");
  if (links && site.email) {
    links.append(el("li", {}, el("a", { href: `mailto:${site.email}`, textContent: site.email })));
  }
  if (links && site.instagram) {
    const handle = site.instagram.replace(/^@/, "");
    links.append(
      el("li", {}, el("a", { href: `https://instagram.com/${handle}`, textContent: `Instagram @${handle}` }))
    );
  }
}

// Home page: the headline image set in site.json.
function renderFeatured(site) {
  const section = document.querySelector(".featured");
  if (!section || !site.headline_image) return;
  section.replaceChildren(
    el("img", { src: asset(site.headline_image), alt: site.headline_caption || site.name, fetchPriority: "high" }),
    el(
      "div",
      { className: "featured-caption" },
      el("span", { className: "caption-meta", textContent: site.headline_caption })
    )
  );
  fitToWindow(section);
}

// Size the headline image so it and its caption fill the first screen, with
// About below. The header and caption are measured, so it adapts to them
// wrapping at any width.
function fitToWindow(section) {
  const img = section.querySelector("img");
  const header = document.querySelector(".site-header");
  const fit = () => {
    // Run twice: the caption can rewrap once the image width changes.
    for (let i = 0; i < 2; i++) {
      const rest = header.offsetHeight + section.offsetHeight - img.offsetHeight + 24;
      img.style.maxHeight = `${Math.max(window.innerHeight - rest, 120)}px`;
    }
  };
  fit();
  img.addEventListener("load", fit);
  window.addEventListener("resize", fit);
}

function renderGallery(works, name) {
  const gallery = document.querySelector(".gallery");
  if (!gallery) return;
  const lightbox = createLightbox(name);
  gallery.replaceChildren(
    ...works.map((work, i) =>
      el(
        "li",
        {},
        el(
          "button",
          { type: "button", onclick: () => lightbox.open(works, i) },
          el("img", { src: asset(work.image), alt: work.title, loading: i < 3 ? "eager" : "lazy" }),
          el("span", { className: "caption" }, ...caption(work))
        )
      )
    )
  );
}

function createLightbox(name) {
  const dialog = document.querySelector(".lightbox");
  const img = dialog.querySelector("img");
  const figure = dialog.querySelector("figure");
  const figcaption = dialog.querySelector("figcaption");
  const fade = { duration: 350, easing: "ease" };
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let items = [];
  let index = 0;

  const show = () => {
    const work = items[index];
    img.src = asset(work.image);
    img.alt = work.title;
    figcaption.replaceChildren(
      ...caption(work),
      el("span", { className: "copyright", textContent: `© ${name}` })
    );
    const single = items.length < 2;
    dialog.querySelector(".lightbox-prev").hidden = single;
    dialog.querySelector(".lightbox-next").hidden = single;
  };

  // Crossfade: put copies of the current image and caption beneath them, swap
  // in the next work, and fade it in on top. The copies stay solid for the
  // first half, so a browser that is slow to draw the new image never shows a
  // blank frame.
  const ghost = (node) => {
    const copy = node.cloneNode(true);
    const r = node.getBoundingClientRect();
    const f = figure.getBoundingClientRect();
    copy.className = "lightbox-fading";
    Object.assign(copy.style, {
      left: `${r.left - f.left}px`,
      top: `${r.top - f.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    figure.append(copy);
    return copy;
  };

  let latest = 0;
  const crossfade = async () => {
    const run = ++latest;
    figure.querySelectorAll(".lightbox-fading").forEach((old) => old.remove());
    if (reduceMotion()) return show();
    const ghosts = [ghost(img), ghost(figcaption)];
    // Wait until the copy can be drawn, or some browsers show a blank frame.
    await ghosts[0].decode().catch(() => {});
    if (run !== latest) return; // A newer step has taken over.
    img.style.opacity = figcaption.style.opacity = 0;
    show();
    await img.decode().catch(() => {});
    img.style.opacity = figcaption.style.opacity = "";
    img.animate([{ opacity: 0 }, { opacity: 1 }], fade);
    figcaption.animate([{ opacity: 0 }, { opacity: 1 }], fade);
    ghosts.forEach((old) =>
      old.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { ...fade, fill: "forwards" }).finished.then(
        () => old.remove(),
        () => {}
      )
    );
  };

  const step = (delta) => {
    index = (index + delta + items.length) % items.length;
    crossfade();
  };

  // Fade the whole view in on open and out on close. Escape fades out too.
  const fadeDialog = (from, to) =>
    reduceMotion() ? Promise.resolve() : dialog.animate([{ opacity: from }, { opacity: to }], fade).finished;
  const close = () => fadeDialog(1, 0).then(() => dialog.close());
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // Stop the page behind from scrolling (and showing a scrollbar) while open.
  dialog.addEventListener("close", () => (document.documentElement.style.overflow = ""));

  dialog.querySelector(".lightbox-close").onclick = close;
  dialog.querySelector(".lightbox-prev").onclick = () => step(-1);
  dialog.querySelector(".lightbox-next").onclick = () => step(1);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  return {
    open(list, i) {
      items = list;
      index = i;
      show();
      document.documentElement.style.overflow = "hidden";
      dialog.showModal();
      // Focus the view itself, not the close button, so phones don't
      // highlight the button on open.
      dialog.focus();
      fadeDialog(0, 1);
    },
  };
}

Promise.all([loadJSON("content/site.json"), loadJSON("content/artworks.json")])
  .then(([site, works]) => {
    const published = works.filter((w) => w.published !== false);
    renderSite(site);
    renderFeatured(site);
    renderGallery(published, site.name);
    // Content is rendered after the page loads, so the browser's own jump to
    // #about (e.g. from the portfolio page) lands too early. Redo it once the
    // images have loaded and the layout has settled.
    const jump = () => location.hash && document.querySelector(location.hash)?.scrollIntoView({ behavior: "instant" });
    const images = [...document.querySelectorAll("main img")].map(
      (img) =>
        img.complete ||
        new Promise((done) => {
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    );
    jump();
    Promise.all(images).then(jump);
  })
  .catch((err) => {
    console.error(err);
    document.querySelector("main").prepend(el("p", { textContent: "Sorry, the page could not be loaded." }));
  });
