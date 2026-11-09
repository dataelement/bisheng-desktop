#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DSH_HOME="${DIR}/data"
export PORT="${PORT:-3080}"
export HOST="${HOST:-0.0.0.0}"
export NODE_ENV="production"

# 1. 检查 Node.js 环境
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (推荐 20+ 或 22+)"
  exit 1
fi

# 2. 初始化数据目录与 Profile
mkdir -p "${DSH_HOME}"
if [ ! -d "${DSH_HOME}/profiles/web" ]; then
  echo "ℹ️ [INFO] 正在初始化 Web Profile 配置..."
  mkdir -p "${DSH_HOME}/profiles/web"
  [ -f "${DIR}/profile/package.json" ] && cp "${DIR}/profile/package.json" "${DSH_HOME}/profiles/web/package.json"
  [ -f "${DIR}/profile/cordis.yml" ] && cp "${DIR}/profile/cordis.yml" "${DSH_HOME}/profiles/web/cordis.yml"
fi

echo "========================================================"
echo "  BiSheng / DeepSeek Harness Web Service"
echo "========================================================"
echo "  根目录:      ${DIR}"
echo "  数据目录:    ${DSH_HOME}"
echo "  访问地址:    http://${HOST}:${PORT}"
echo "========================================================"

# 3. 寻找并执行启动入口
if [ -f "${DIR}/core/apps/cli/lib/bin.js" ]; then
  cd "${DIR}/core"
  exec node apps/cli/lib/bin.js web --port "${PORT}" --host "${HOST}" --no-open
elif [ -f "${DIR}/core/apps/cli/src/bin.ts" ]; then
  cd "${DIR}/core"
  exec npx tsx apps/cli/src/bin.ts web --port "${PORT}" --host "${HOST}" --no-open
elif [ -f "${DIR}/../deepseek-harness/apps/cli/src/bin.ts" ]; then
  echo "ℹ️ [INFO] 使用同级 deepseek-harness 源码启动..."
  cd "${DIR}/../deepseek-harness"
  exec npx tsx apps/cli/src/bin.ts web --port "${PORT}" --host "${HOST}" --no-open
else
  echo "❌ 错误: 未找到 Harness 运行时入口 (core/apps/cli/ 或 ../deepseek-harness)"
  exit 1
fi
