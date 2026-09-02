import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import type {
  Category,
  Ingredient,
  ModifierGroup,
  ModifierOption,
  Product,
  Recipe,
} from '@/types/domain'

/**
 * Data contoh F&B awal supaya kafe bisa langsung mulai bertransaksi setelah onboarding.
 * Semua item dapat diedit/dihapus kapan saja lewat menu Produk.
 */
export async function seedInitialCatalog(): Promise<void> {
  const alreadySeeded = await db.categories.count()
  if (alreadySeeded > 0) return

  const now = Date.now()

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

  function product(input: {
    categoryId: string
    name: string
    sku: string
    price: number
    costPrice: number
    stockQty: number
    modifierGroupIds: string[]
    isFavorite?: boolean
  }): Product {
    return {
      id: newId(),
      categoryId: input.categoryId,
      name: input.name,
      sku: input.sku,
      barcode: null,
      price: input.price,
      costPrice: input.costPrice,
      unit: 'pcs',
      photoDataUrl: null,
      trackOwnStock: true,
      stockQty: input.stockQty,
      lowStockThreshold: 10,
      isFavorite: input.isFavorite ?? false,
      isAvailable: true,
      modifierGroupIds: input.modifierGroupIds,
      createdAt: now,
      updatedAt: now,
    }
  }

  const products: Product[] = [
    product({ categoryId: kopi!.id, name: 'Espresso', sku: 'KOPI-001', price: 18000, costPrice: 6000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Americano', sku: 'KOPI-002', price: 20000, costPrice: 6500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Cappuccino', sku: 'KOPI-003', price: 25000, costPrice: 9000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Cafe Latte', sku: 'KOPI-004', price: 25000, costPrice: 9000, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Kopi Susu Gula Aren', sku: 'KOPI-005', price: 22000, costPrice: 8000, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),
    product({ categoryId: kopi!.id, name: 'Vanilla Latte', sku: 'KOPI-006', price: 27000, costPrice: 9500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: kopi!.id, name: 'Es Kopi Kikost', sku: 'KOPI-007', price: 25000, costPrice: 8500, stockQty: 100, modifierGroupIds: drinkModifiers, isFavorite: true }),

    product({ categoryId: nonKopi!.id, name: 'Matcha Latte', sku: 'NONKOPI-001', price: 26000, costPrice: 10000, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Chocolate', sku: 'NONKOPI-002', price: 23000, costPrice: 9000, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Taro Latte', sku: 'NONKOPI-003', price: 24000, costPrice: 9500, stockQty: 80, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Teh Manis', sku: 'NONKOPI-004', price: 10000, costPrice: 2500, stockQty: 100, modifierGroupIds: drinkModifiers }),
    product({ categoryId: nonKopi!.id, name: 'Lemon Tea', sku: 'NONKOPI-005', price: 15000, costPrice: 4500, stockQty: 100, modifierGroupIds: drinkModifiers }),

    product({ categoryId: makanan!.id, name: 'Nasi Goreng Kikost', sku: 'FOOD-001', price: 28000, costPrice: 12000, stockQty: 50, modifierGroupIds: spicyFoodModifiers, isFavorite: true }),
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
  const esKopiKikost = products.find((p) => p.sku === 'KOPI-007')!
  const cappuccino = products.find((p) => p.sku === 'KOPI-003')!

  await db.products.update(kopiSusuGulaAren.id, { trackOwnStock: false })
  await db.products.update(esKopiKikost.id, { trackOwnStock: false })
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
      productId: esKopiKikost.id,
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
