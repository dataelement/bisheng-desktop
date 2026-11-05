#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DSH_HOME="${DIR}/data"
export PORT="${PORT:-3080}"
export HOST="${HOST:-0.0.0.0}"
export NODE_ENV="production"

# 检查 Node.js 运行环境（要求 >= 20，推荐 22+）
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (>=20.0.0)"
  exit 1
fi

mkdir -p "${DSH_HOME}"

echo "=========================================="
echo "🚀 正在启动 毕昇 Web 服务..."
echo "📍 根目录: ${DIR}"
echo "🌐 访问地址: http://${HOST}:${PORT}"
echo "📁 数据目录: ${DSH_HOME}"
echo "=========================================="

# 优先查找 core/ 中的 Harness 入口，其次使用本地安装
if [ -f "${DIR}/core/apps/cli/src/bin.ts" ]; then
  cd "${DIR}/core"
  exec node --import tsx/esm apps/cli/src/bin.ts web --port "${PORT}" --host "${HOST}" --no-open
elif [ -f "${DIR}/core/apps/cli/bin.js" ]; then
  cd "${DIR}/core"
  exec node apps/cli/bin.js web --port "${PORT}" --host "${HOST}" --no-open
elif [ -f "${DIR}/core/node_modules/@deepseek-ai/dsh/lib/bin.js" ]; then
  cd "${DIR}/core"
  exec node node_modules/@deepseek-ai/dsh/lib/bin.js web --port "${PORT}" --host "${HOST}" --no-open
else
  # 降级：如果 deepseek-harness 就在同级，或作为外部 harness 使用
  HARNESS_DIR="${DIR}/../deepseek-harness"
  if [ -d "${HARNESS_DIR}" ]; then
    cd "${HARNESS_DIR}"
    exec node --import tsx/esm apps/cli/src/bin.ts web --port "${PORT}" --host "${HOST}" --no-open
  else
    echo "❌ 错误: 未找到 Harness 运行时入口 (core/apps/cli/bin.js 或 ../deepseek-harness)"
    exit 1
  fi
fi
