// Score de qualité d'une annonce : 100 points répartis sur ce qui fait vendre.

import { normalizeDraft } from './schema.js';

const RULES = [
  {
    id: 'title',
    label: 'Titre précis (20 à 70 caractères)',
    max: 15,
    test: (d) => d.title.length >= 20 && d.title.length <= 70,
    hint: 'Ajoutez la marque, le type et la taille.',
  },
  {
    id: 'description',
    label: 'Description détaillée (80 caractères minimum)',
    max: 20,
    test: (d) => d.description.length >= 80,
    hint: 'Matière, mesures, défauts, raison de la vente.',
  },
  {
    id: 'photos',
    label: 'Trois photos ou plus',
    max: 20,
    test: (d) => d.photos.length >= 3,
    partial: (d) => (d.photos.length >= 1 ? 8 : 0),
    hint: 'Face, dos et étiquette : les annonces à 3 photos vendent mieux.',
  },
  {
    id: 'category',
    label: 'Catégorie renseignée',
    max: 10,
    test: (d) => Boolean(d.catalogId),
    hint: 'La catégorie conditionne la taille et la visibilité.',
  },
  {
    id: 'brand',
    label: 'Marque reconnue',
    max: 10,
    test: (d) => Boolean(d.brand && d.brandId),
    partial: (d) => (d.brand ? 5 : 0),
    hint: 'Choisissez la marque dans la liste pour être trouvé.',
  },
  {
    id: 'size',
    label: 'Taille indiquée',
    max: 10,
    test: (d) => Boolean(d.sizeId),
    hint: 'Obligatoire pour beaucoup de catégories.',
  },
  {
    id: 'colors',
    label: 'Couleur principale',
    max: 5,
    test: (d) => d.colorIds.length > 0,
    hint: 'La couleur sert aux filtres de recherche.',
  },
  {
    id: 'price',
    label: 'Prix cohérent (5 € minimum)',
    max: 5,
    test: (d) => Number(d.price) >= 5,
    hint: 'En dessous de 5 €, les frais dépassent le prix.',
  },
  {
    id: 'condition',
    label: 'État renseigné',
    max: 5,
    test: (d) => Boolean(d.conditionId),
    hint: "L'état rassure l'acheteur.",
  },
];

export function scoreDraft(input) {
  const draft = normalizeDraft(input);
  const criteria = RULES.map((rule) => {
    const ok = rule.test(draft);
    const points = ok ? rule.max : rule.partial ? rule.partial(draft) : 0;
    return {
      id: rule.id,
      label: rule.label,
      hint: rule.hint,
      max: rule.max,
      points,
      ok,
      partial: !ok && points > 0,
    };
  });
  const score = criteria.reduce((total, item) => total + item.points, 0);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  return { score, grade, criteria };
}
