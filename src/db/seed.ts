import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import type {
  BusinessType,
  Category,
  Ingredient,
  ModifierGroup,
  ModifierOption,
  Product,
  Recipe,
} from '@/types/domain'

/**
 * Data contoh awal sesuai jenis usaha supaya bisa langsung bertransaksi setelah
 * onboarding. Semua item dapat diedit/dihapus kapan saja lewat menu Produk.
 */
export async function seedInitialCatalog(businessType: BusinessType = 'cafe_resto'): Promise<void> {
  const alreadySeeded = await db.categories.count()
  if (alreadySeeded > 0) return

  const now = Date.now()
  switch (businessType) {
    case 'kantin':
      return seedKantinCatalog(now)
    case 'minimarket':
      return seedMinimarketCatalog(now)
    default:
      return seedCafeCatalog(now)
  }
}

function makeProduct(now: number, input: {
  categoryId: string
  name: string
  sku: string
  price: number
  costPrice: number
  stockQty: number
  modifierGroupIds: string[]
  isFavorite?: boolean
  barcode?: string
  lowStockThreshold?: number
}): Product {
  return {
    id: newId(),
    categoryId: input.categoryId,
    name: input.name,
    sku: input.sku,
    barcode: input.barcode ?? null,
    price: input.price,
    costPrice: input.costPrice,
    unit: 'pcs',
    photoDataUrl: null,
    trackOwnStock: true,
    stockQty: input.stockQty,
    lowStockThreshold: input.lowStockThreshold ?? 10,
    isFavorite: input.isFavorite ?? false,
    isAvailable: true,
    modifierGroupIds: input.modifierGroupIds,
    createdAt: now,
    updatedAt: now,
  }
}

function category(now: number, name: string, sortOrder: number): Category {
  return { id: newId(), name, sortOrder, active: true, createdAt: now, updatedAt: now }
}

/** Kafe & resto: kopi/non-kopi dengan modifier + resep bahan baku. */
async function seedCafeCatalog(now: number): Promise<void> {
  const product = (input: Parameters<typeof makeProduct>[1]) => makeProduct(now, input)

  const categories: Category[] = [
    { id: newId(), name: 'Kopi', sortOrder: 0, active: true, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Non-Kopi', sortOrder: 1, active: true, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Makanan', sortOrder: 2, active: true, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Snack', sortOrder: 3, active: true, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Dessert', sortOrder: 4, active: true, createdAt: now, updatedAt: now },
  ]
  await db.categories.bulkAdd(categories)
  const [kopi, nonKopi, makanan, snack, dessert] = categories

  const modifierGroups: ModifierGroup[] = [
    { id: newId(), name: 'Ukuran', type: 'size', required: true, multiSelect: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Level Gula', type: 'sugar', required: true, multiSelect: false, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Level Es', type: 'ice', required: true, multiSelect: false, sortOrder: 2, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Topping', type: 'topping', required: false, multiSelect: true, sortOrder: 3, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Tingkat Kepedasan', type: 'spice', required: true, multiSelect: false, sortOrder: 4, createdAt: now, updatedAt: now },
  ]
  await db.modifierGroups.bulkAdd(modifierGroups)
  const [sizeGroup, sugarGroup, iceGroup, toppingGroup, spiceGroup] = modifierGroups

  const modifierOptions: ModifierOption[] = [
    { id: newId(), groupId: sizeGroup!.id, name: 'Regular', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: sizeGroup!.id, name: 'Large', priceDelta: 5000, sortOrder: 1 },

    { id: newId(), groupId: sugarGroup!.id, name: 'Normal', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: sugarGroup!.id, name: 'Kurang Gula', priceDelta: 0, sortOrder: 1 },
    { id: newId(), groupId: sugarGroup!.id, name: 'Tanpa Gula', priceDelta: 0, sortOrder: 2 },

    { id: newId(), groupId: iceGroup!.id, name: 'Normal', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: iceGroup!.id, name: 'Sedikit Es', priceDelta: 0, sortOrder: 1 },
    { id: newId(), groupId: iceGroup!.id, name: 'Tanpa Es', priceDelta: 0, sortOrder: 2 },

    { id: newId(), groupId: toppingGroup!.id, name: 'Boba', priceDelta: 5000, sortOrder: 0 },
    { id: newId(), groupId: toppingGroup!.id, name: 'Extra Shot Espresso', priceDelta: 8000, sortOrder: 1 },
    { id: newId(), groupId: toppingGroup!.id, name: 'Whipped Cream', priceDelta: 5000, sortOrder: 2 },

    { id: newId(), groupId: spiceGroup!.id, name: 'Tidak Pedas', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: spiceGroup!.id, name: 'Level 1', priceDelta: 0, sortOrder: 1 },
    { id: newId(), groupId: spiceGroup!.id, name: 'Level 2', priceDelta: 0, sortOrder: 2 },
    { id: newId(), groupId: spiceGroup!.id, name: 'Level 3', priceDelta: 0, sortOrder: 3 },
  ]
  await db.modifierOptions.bulkAdd(modifierOptions)

  const drinkModifiers = [sizeGroup!.id, sugarGroup!.id, iceGroup!.id, toppingGroup!.id]
  const spicyFoodModifiers = [spiceGroup!.id]

  const products: Product[] = [
    product({ categoryId: kopi!.id, name: 'Espresso', sku: 'KOPI-001', price: 18000, costPrice: 6000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Americano', sku: 'KOPI-002', price: 20000, costPrice: 6500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Cappuccino', sku: 'KOPI-003', price: 25000, costPrice: 9000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Cafe Latte', sku: 'KOPI-004', price: 25000, costPrice: 9000, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Kopi Susu Gula Aren', sku: 'KOPI-005', price: 22000, costPrice: 8000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Vanilla Latte', sku: 'KOPI-006', price: 27000, costPrice: 9500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Es Kopi Susu', sku: 'KOPI-007', price: 25000, costPrice: 8500, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),

    product({ categoryId: nonKopi!.id, name: 'Matcha Latte', sku: 'NONKOPI-001', price: 26000, costPrice: 10000, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Chocolate', sku: 'NONKOPI-002', price: 23000, costPrice: 9000, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Taro Latte', sku: 'NONKOPI-003', price: 24000, costPrice: 9500, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Teh Manis', sku: 'NONKOPI-004', price: 10000, costPrice: 2500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Lemon Tea', sku: 'NONKOPI-005', price: 15000, costPrice: 4500, stockQty: 100, modifierGroupIds: drinkModifiers }),

    product({ categoryId: makanan!.id, name: 'Nasi Goreng Spesial', sku: 'FOOD-001', price: 28000, costPrice: 12000, stockQty: 50, modifierGroupIds: spicyFoodModifiers, isFavorite: true }),
    product({ categoryId: makanan!.id, name: 'Mie Goreng', sku: 'FOOD-002', price: 25000, costPrice: 10000, stockQty: 50, modifierGroupIds: spicyFoodModifiers }),
    product({ categoryId: makanan!.id, name: 'Ayam Geprek', sku: 'FOOD-003', price: 30000, costPrice: 14000, stockQty: 50, modifierGroupIds: spicyFoodModifiers, isFavorite: true }),

    product({ categoryId: snack!.id, name: 'Roti Bakar Coklat Keju', sku: 'SNACK-001', price: 18000, costPrice: 7000, stockQty: 40, modifierGroupIds: [] }),
    product({ categoryId: snack!.id, name: 'Kentang Goreng', sku: 'SNACK-002', price: 15000, costPrice: 5000, stockQty: 60, modifierGroupIds: [] }),
    product({ categoryId: snack!.id, name: 'Pisang Goreng Keju', sku: 'SNACK-003', price: 17000, costPrice: 6000, stockQty: 40, modifierGroupIds: [] }),

    product({ categoryId: dessert!.id, name: 'Croffle', sku: 'DESSERT-001', price: 20000, costPrice: 8000, stockQty: 30, modifierGroupIds: [] }),
    product({ categoryId: dessert!.id, name: 'Waffle', sku: 'DESSERT-002', price: 22000, costPrice: 9000, stockQty: 30, modifierGroupIds: [] }),
  ]
  await db.products.bulkAdd(products)

  const ingredients: Ingredient[] = [
    { id: newId(), name: 'Biji Kopi', unit: 'g', stockQty: 5000, lowStockThreshold: 500, costPerUnit: 250, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Susu Segar', unit: 'ml', stockQty: 10000, lowStockThreshold: 1000, costPerUnit: 20, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Gula Aren Cair', unit: 'ml', stockQty: 4000, lowStockThreshold: 500, costPerUnit: 40, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Es Batu', unit: 'g', stockQty: 20000, lowStockThreshold: 2000, costPerUnit: 5, createdAt: now, updatedAt: now },
  ]
  await db.ingredients.bulkAdd(ingredients)
  const [bijiKopi, susu, gulaAren, esBatu] = ingredients

  const kopiSusuGulaAren = products.find((p) => p.sku === 'KOPI-005')!
  const esKopiSusu = products.find((p) => p.sku === 'KOPI-007')!
  const cappuccino = products.find((p) => p.sku === 'KOPI-003')!

  await db.products.update(kopiSusuGulaAren.id, { trackOwnStock: false })
  await db.products.update(esKopiSusu.id, { trackOwnStock: false })
  await db.products.update(cappuccino.id, { trackOwnStock: false })

  const recipes: Recipe[] = [
    {
      id: newId(),
      productId: kopiSusuGulaAren.id,
      items: [
        { ingredientId: bijiKopi!.id, qty: 18 },
        { ingredientId: susu!.id, qty: 120 },
        { ingredientId: gulaAren!.id, qty: 30 },
        { ingredientId: esBatu!.id, qty: 150 },
      ],
      updatedAt: now,
    },
    {
      id: newId(),
      productId: esKopiSusu.id,
      items: [
        { ingredientId: bijiKopi!.id, qty: 20 },
        { ingredientId: susu!.id, qty: 100 },
        { ingredientId: esBatu!.id, qty: 150 },
      ],
      updatedAt: now,
    },
    {
      id: newId(),
      productId: cappuccino.id,
      items: [
        { ingredientId: bijiKopi!.id, qty: 18 },
        { ingredientId: susu!.id, qty: 150 },
      ],
      updatedAt: now,
    },
  ]
  await db.recipes.bulkAdd(recipes)
}

/** Kantin: makanan & minuman harian, modifier sederhana (pedas, es), tanpa resep. */
async function seedKantinCatalog(now: number): Promise<void> {
  const product = (input: Parameters<typeof makeProduct>[1]) => makeProduct(now, input)
  const categories = [category(now, 'Makanan', 0), category(now, 'Minuman', 1), category(now, 'Gorengan & Snack', 2)]
  await db.categories.bulkAdd(categories)
  const [makanan, minuman, snack] = categories

  const modifierGroups: ModifierGroup[] = [
    { id: newId(), name: 'Tingkat Kepedasan', type: 'spice', required: false, multiSelect: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Panas / Dingin', type: 'ice', required: true, multiSelect: false, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: newId(), name: 'Tambahan', type: 'topping', required: false, multiSelect: true, sortOrder: 2, createdAt: now, updatedAt: now },
  ]
  await db.modifierGroups.bulkAdd(modifierGroups)
  const [spiceGroup, tempGroup, extraGroup] = modifierGroups

  const modifierOptions: ModifierOption[] = [
    { id: newId(), groupId: spiceGroup!.id, name: 'Tidak Pedas', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: spiceGroup!.id, name: 'Sedang', priceDelta: 0, sortOrder: 1 },
    { id: newId(), groupId: spiceGroup!.id, name: 'Pedas', priceDelta: 0, sortOrder: 2 },

    { id: newId(), groupId: tempGroup!.id, name: 'Es', priceDelta: 0, sortOrder: 0 },
    { id: newId(), groupId: tempGroup!.id, name: 'Hangat', priceDelta: 0, sortOrder: 1 },

    { id: newId(), groupId: extraGroup!.id, name: 'Telur Ceplok', priceDelta: 4000, sortOrder: 0 },
    { id: newId(), groupId: extraGroup!.id, name: 'Nasi Tambah', priceDelta: 4000, sortOrder: 1 },
    { id: newId(), groupId: extraGroup!.id, name: 'Kerupuk', priceDelta: 2000, sortOrder: 2 },
  ]
  await db.modifierOptions.bulkAdd(modifierOptions)

  const foodModifiers = [spiceGroup!.id, extraGroup!.id]
  const drinkModifiers = [tempGroup!.id]

  const products: Product[] = [
    product({ categoryId: makanan!.id, name: 'Nasi Ayam Goreng', sku: 'KTN-001', price: 15000, costPrice: 9000, stockQty: 50, modifierGroupIds: foodModifiers, isFavorite: true }),
    product({ categoryId: makanan!.id, name: 'Nasi Goreng', sku: 'KTN-002', price: 13000, costPrice: 7000, stockQty: 50, modifierGroupIds: foodModifiers, isFavorite: true }),
    product({ categoryId: makanan!.id, name: 'Mie Goreng', sku: 'KTN-003', price: 12000, costPrice: 6000, stockQty: 50, modifierGroupIds: foodModifiers }),
    product({ categoryId: makanan!.id, name: 'Mie Rebus', sku: 'KTN-004', price: 12000, costPrice: 6000, stockQty: 50, modifierGroupIds: foodModifiers }),
    product({ categoryId: makanan!.id, name: 'Nasi Rames', sku: 'KTN-005', price: 14000, costPrice: 8000, stockQty: 50, modifierGroupIds: foodModifiers }),
    product({ categoryId: makanan!.id, name: 'Soto Ayam', sku: 'KTN-006', price: 13000, costPrice: 7000, stockQty: 40, modifierGroupIds: [spiceGroup!.id] }),

    product({ categoryId: minuman!.id, name: 'Teh Manis', sku: 'KTN-101', price: 4000, costPrice: 1000, stockQty: 200, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: minuman!.id, name: 'Jeruk', sku: 'KTN-102', price: 6000, costPrice: 2500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: minuman!.id, name: 'Kopi Hitam', sku: 'KTN-103', price: 5000, costPrice: 1500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: minuman!.id, name: 'Air Mineral', sku: 'KTN-104', price: 4000, costPrice: 2000, stockQty: 100, modifierGroupIds: [] }),

    product({ categoryId: snack!.id, name: 'Tempe Goreng', sku: 'KTN-201', price: 1500, costPrice: 700, stockQty: 100, modifierGroupIds: [] }),
    product({ categoryId: snack!.id, name: 'Bakwan', sku: 'KTN-202', price: 1500, costPrice: 700, stockQty: 100, modifierGroupIds: [] }),
    product({ categoryId: snack!.id, name: 'Kerupuk', sku: 'KTN-203', price: 2000, costPrice: 1000, stockQty: 100, modifierGroupIds: [] }),
  ]
  await db.products.bulkAdd(products)
}

/** Minimarket: barang kemasan dengan barcode, tanpa modifier/resep — stok per produk. */
async function seedMinimarketCatalog(now: number): Promise<void> {
  const product = (input: Parameters<typeof makeProduct>[1]) => makeProduct(now, input)
  const categories = [
    category(now, 'Makanan Ringan', 0),
    category(now, 'Minuman', 1),
    category(now, 'Sembako', 2),
    category(now, 'Kebutuhan Rumah', 3),
    category(now, 'Perawatan Diri', 4),
  ]
  await db.categories.bulkAdd(categories)
  const [snack, minuman, sembako, rumah, perawatan] = categories

  // Barcode contoh (format EAN-13) — ganti dengan barcode asli di kemasan lewat menu Produk.
  const products: Product[] = [
    product({ categoryId: snack!.id, name: 'Keripik Kentang 68g', sku: 'MM-001', barcode: '8990000000017', price: 11500, costPrice: 9000, stockQty: 24, lowStockThreshold: 6, modifierGroupIds: [], isFavorite: true }),
    product({ categoryId: snack!.id, name: 'Biskuit Cokelat 120g', sku: 'MM-002', barcode: '8990000000024', price: 9500, costPrice: 7500, stockQty: 24, lowStockThreshold: 6, modifierGroupIds: [] }),
    product({ categoryId: snack!.id, name: 'Wafer Vanila 50g', sku: 'MM-003', barcode: '8990000000031', price: 3000, costPrice: 2200, stockQty: 48, lowStockThreshold: 12, modifierGroupIds: [] }),

    product({ categoryId: minuman!.id, name: 'Air Mineral 600ml', sku: 'MM-101', barcode: '8990000000109', price: 4000, costPrice: 2800, stockQty: 48, lowStockThreshold: 12, modifierGroupIds: [], isFavorite: true }),
    product({ categoryId: minuman!.id, name: 'Teh Botol 350ml', sku: 'MM-102', barcode: '8990000000116', price: 5000, costPrice: 3800, stockQty: 24, lowStockThreshold: 6, modifierGroupIds: [] }),
    product({ categoryId: minuman!.id, name: 'Kopi Kaleng 240ml', sku: 'MM-103', barcode: '8990000000123', price: 8000, costPrice: 6200, stockQty: 24, lowStockThreshold: 6, modifierGroupIds: [] }),

    product({ categoryId: sembako!.id, name: 'Beras 5kg', sku: 'MM-201', barcode: '8990000000208', price: 72000, costPrice: 65000, stockQty: 10, lowStockThreshold: 3, modifierGroupIds: [] }),
    product({ categoryId: sembako!.id, name: 'Minyak Goreng 1L', sku: 'MM-202', barcode: '8990000000215', price: 18000, costPrice: 15500, stockQty: 20, lowStockThreshold: 5, modifierGroupIds: [], isFavorite: true }),
    product({ categoryId: sembako!.id, name: 'Gula Pasir 1kg', sku: 'MM-203', barcode: '8990000000222', price: 17500, costPrice: 15000, stockQty: 20, lowStockThreshold: 5, modifierGroupIds: [] }),
    product({ categoryId: sembako!.id, name: 'Mie Instan Goreng', sku: 'MM-204', barcode: '8990000000239', price: 3500, costPrice: 2700, stockQty: 80, lowStockThreshold: 20, modifierGroupIds: [], isFavorite: true }),
    product({ categoryId: sembako!.id, name: 'Telur Ayam (10 butir)', sku: 'MM-205', barcode: '8990000000246', price: 28000, costPrice: 24000, stockQty: 15, lowStockThreshold: 4, modifierGroupIds: [] }),

    product({ categoryId: rumah!.id, name: 'Sabun Cuci Piring 400ml', sku: 'MM-301', barcode: '8990000000307', price: 12000, costPrice: 9500, stockQty: 12, lowStockThreshold: 3, modifierGroupIds: [] }),
    product({ categoryId: rumah!.id, name: 'Tisu 250 lembar', sku: 'MM-302', barcode: '8990000000314', price: 14000, costPrice: 11000, stockQty: 12, lowStockThreshold: 3, modifierGroupIds: [] }),

    product({ categoryId: perawatan!.id, name: 'Sabun Mandi Batang', sku: 'MM-401', barcode: '8990000000406', price: 4500, costPrice: 3500, stockQty: 24, lowStockThreshold: 6, modifierGroupIds: [] }),
    product({ categoryId: perawatan!.id, name: 'Pasta Gigi 150g', sku: 'MM-402', barcode: '8990000000413', price: 13000, costPrice: 10500, stockQty: 12, lowStockThreshold: 3, modifierGroupIds: [] }),
  ]
  await db.products.bulkAdd(products)
}
