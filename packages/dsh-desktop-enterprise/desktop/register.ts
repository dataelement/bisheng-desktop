import { registerDesktopProduct } from '../../../src/main/shell/product-runtime'
import { createEnterpriseProductRuntime } from './runtime'

registerDesktopProduct(createEnterpriseProductRuntime)
