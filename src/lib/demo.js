// Transport de démonstration : simule Vinted pour tester l'interface et la
// chaîne de publication sans toucher au vrai site.

const CATALOGS = [
  { id: 1904, title: 'Robes', path: 'Femmes > Vêtements > Robes' },
  { id: 1908, title: 'Sweats et pulls', path: 'Femmes > Vêtements > Sweats et pulls' },
  { id: 1206, title: 'Sneakers', path: 'Hommes > Chaussures > Sneakers' },
  { id: 1801, title: 'Chemises', path: 'Hommes > Vêtements > Chemises' },
  { id: 2080, title: 'Sacs à main', path: 'Femmes > Sacs > Sacs à main' },
];

const BRANDS = [
  { id: 14, title: 'Adidas' },
  { id: 94, title: 'Tommy Hilfiger' },
  { id: 53, title: 'Nike' },
  { id: 179, title: 'Zara' },
  { id: 104, title: 'Levi’s' },
];

const COLORS = [
  { id: 1, title: 'Noir' },
  { id: 2, title: 'Blanc' },
  { id: 3, title: 'Gris' },
  { id: 7, title: 'Bleu' },
  { id: 10, title: 'Rouge' },
  { id: 12, title: 'Vert' },
  { id: 15, title: 'Multicolore' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((label, index) => ({
  id: 206 + index,
  title: label,
  group: 'Tailles standard',
}));

let sequence = 900000;

export function createDemoTransport({ latency = 350 } = {}) {
  return async function transport(request) {
    await delay(latency + Math.random() * 250);
    const path = String(request.path || '');
    const url = new URL(path, 'https://www.vinted.fr');

    if (path.startsWith('/api/v2/users/current')) {
      return json(200, { user: { id: 1, login: 'demo_vendeur' } });
    }
    if (path.startsWith('/api/v2/item_upload/catalogs/search') || path.startsWith('/api/v2/catalogs')) {
      const keyword = (url.searchParams.get('keyword') || url.searchParams.get('search_text') || '').toLowerCase();
      const list = CATALOGS.filter((c) => !keyword || c.title.toLowerCase().includes(keyword) || c.path.toLowerCase().includes(keyword));
      return json(200, { catalogs: list });
    }
    if (path.startsWith('/api/v2/brands')) {
      const keyword = (url.searchParams.get('keyword') || '').toLowerCase();
      const list = BRANDS.filter((b) => !keyword || b.title.toLowerCase().includes(keyword));
      return json(200, { brands: list });
    }
    if (path.startsWith('/api/v2/colors')) {
      return json(200, { colors: COLORS });
    }
    if (path.startsWith('/api/v2/item_upload/configuration') || path.startsWith('/api/v2/size_groups') || path.startsWith('/api/v2/sizes')) {
      return json(200, { size_groups: [{ id: 14, title: 'Tailles standard', sizes: SIZES }] });
    }
    if (path.startsWith('/api/v2/catalog/items')) {
      const base = 14 + (Math.abs(hash(path)) % 20);
      const items = Array.from({ length: 24 }, (_, index) => ({
        id: 700000 + index,
        title: `Article similaire ${index + 1}`,
        price: { amount: String(base + (index % 12) * 2 + 0.5) },
      }));
      return json(200, { items });
    }
    if (path === '/api/v2/photos') {
      sequence += 1;
      return json(200, { id: sequence, high_resolution: { id: sequence } });
    }
    if (path === '/api/v2/item_upload/drafts') {
      sequence += 1;
      return json(200, { draft: { id: sequence } });
    }
    if (path === '/api/v2/item_upload/items' || path === '/api/v2/items') {
      sequence += 1;
      const payload = request.json?.item || request.json?.items?.[0] || {};
      return json(200, { item: { id: sequence, title: payload.title, is_draft: false } });
    }
    if (/\/publish$/.test(path)) {
      return json(200, { item: { id: Number(path.match(/(\d+)/)?.[1] || sequence) } });
    }
    return json(404, { message: `Démo : route inconnue ${path}` });
  };
}

function json(status, body) {
  return { status, headers: {}, text: JSON.stringify(body) };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) | 0;
  return value;
}
