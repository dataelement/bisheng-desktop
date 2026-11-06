<h1 align="center">
  <img src="docs/images/readme-logo-black-v020.png" width="274" alt="BISHENG" valign="middle" />
</h1>

<p align="center">
  <strong>O BISHENG Desktop é um Agent de desktop que conecta o trabalho local à IA empresarial.</strong><br />
  Os colaboradores usam a conta empresarial para acessar modelos, bases de conhecimento, ferramentas e habilidades autorizados. O Chat realiza consultas e tarefas de várias etapas na nuvem, enquanto o Work processa materiais locais em diretórios autorizados. A empresa gerencia recursos, permissões, créditos e uso de forma centralizada.<br />
  <a href="https://dshdesktop.com/zh/enterprise/">Baixar BISHENG Desktop</a> · <a href="https://github.com/dataelement/bisheng">Repositório do servidor BISHENG</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ru.md">Русский</a> · <a href="README.es.md">Español</a> · <a href="README.pt.md">Português</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-171513.svg" /></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-171513.svg" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-171513.svg" />
</p>

## O que o BISHENG Desktop pode fazer

- **Chat: delegue tarefas à nuvem empresarial.** Faça perguntas sobre os materiais ou use o modo de tarefas para processamento em várias etapas, execução de habilidades e geração de arquivos, acompanhando o progresso e os resultados.
- **Work: continue trabalhando com materiais locais.** Selecione um diretório autorizado para organizar materiais, analisar dados e gerar arquivos editáveis de Word, Excel e PPT. Continue ajustando os resultados conforme suas orientações e salve-os no diretório permitido.
- **Recursos empresariais conforme as permissões.** Use sua conta empresarial para acessar modelos, espaços de conhecimento, ferramentas API/MCP e habilidades autorizados, além de abrir aplicativos, assistentes e fluxos de trabalho publicados na central de aplicativos.
- **Gestão empresarial centralizada.** Os administradores configuram recursos e permissões, distribuem plugins e painéis de trabalho e gerenciam créditos mensais e uso das chamadas. As chamadas a modelos empresariais no Chat e no Work compartilham o registro de créditos do usuário atual.
- **Colaboração entre web e desktop.** Quando a mesma conta empresarial abre a mesma tarefa do servidor no Chat da web e do desktop, os eventos da tarefa e o status de conclusão podem ser consultados de forma sincronizada. As tarefas locais do Work e seus resultados são gerenciados em registros independentes.

![Interfaces web, desktop e móvel do BISHENG](docs/images/bisheng-platform-overview.png)

> O aplicativo móvel será lançado em breve; os recursos e o cronograma dependem da documentação da versão. As capacidades de integração empresarial, os requisitos de implantação e o escopo das edições de código aberto e empresarial também dependem da documentação correspondente.

## Plataforma BISHENG e projetos relacionados

**O BISHENG é uma plataforma Agent empresarial completa e de código aberto**, voltada à produtividade de escritório e à adoção de IA nas empresas. Fornece ao cliente modelos, conhecimento, ferramentas, habilidades, aplicativos e gestão centralizada.

- [Plataforma empresarial BISHENG](https://github.com/dataelement/bisheng): implante serviços de IA empresarial e gerencie os recursos, permissões e uso da organização de forma centralizada.
- [DSH Desktop](https://github.com/dataelement/dsh-desktop): base de Agent de desktop de código aberto construída sobre o DeepSeek Harness. O BISHENG Desktop usa essa base para conectar serviços de IA empresarial.

## Download e instalação

Obtenha o instalador no [site do BISHENG Desktop](https://dshdesktop.com/zh/enterprise/) e use-o com a plataforma BISHENG implantada na empresa. Entre com sua conta empresarial para acessar os recursos configurados e autorizados pelo administrador.

Para uso pessoal independente, visite o [site do DSH Desktop](https://dshdesktop.com/zh/).

## Arquivos de escritório e recursos de desktop

- **Entrega de arquivos de escritório**: selecione um modelo no modo PPT integrado, descreva o conteúdo e gere um PPTX editável. O ambiente de desktop inclui Python e bibliotecas de Office para gerar e verificar DOCX, PPTX e XLSX. Consulte modelos e verificações no [guia de PPT](packages/ppt-runtime/README.md).
- **Espaços locais e configurações**: gerencie os espaços de trabalho pelo seletor de diretórios do sistema. Profile, plugins, sessões e configurações de modelos ficam fora do diretório de instalação e são preservados nas atualizações. Para importar e exportar configurações personalizadas, consulte o [formato de pacotes Preset](docs/preset-packages.md).
- **Atualizações e recuperação**: as atualizações on-line ainda não estão habilitadas nas instalações atuais. Obtenha um instalador mais recente no [site oficial](https://dshdesktop.com/zh/enterprise/); a habilitação das atualizações on-line depende da documentação da versão. Em caso de falha de plugins, escolha “Reiniciar em modo de segurança…” no menu `Harness` para desabilitar temporariamente plugins de terceiros sem perder os dados do Profile normal. Os diagnósticos são gravados em `harness.log`. Consulte a [recuperação de plugins](docs/architecture.md#profiles-and-plugin-recovery) e as [atualizações](docs/architecture.md#updates).

## Conexão do telefone e limites dos dados

O ambiente de desktop mantém o pareamento do telefone por QR: escolha “Conectar telefone…” no menu `Harness` e escaneie pela rede WiFi. Um túnel de internet também exige a senha exibida no computador. Por padrão, a senha expira em 5 minutos; uma senha permanente só é criada com consentimento explícito. Ao desconectar no desktop, a sessão do telefone é invalidada. Se a conexão falhar, use “Não consegue abrir o link QR? Tentar outra rota”.

Esse pareamento pelo navegador é separado do futuro aplicativo móvel. O Harness funciona em uma porta loopback local aleatória; o telefone acessa por um Bridge de pareamento independente. Isso não sincroniza automaticamente as tarefas locais do Work com as tarefas da nuvem empresarial. Consulte os [limites do acesso móvel](docs/architecture.md#mobile-access-boundary).

O Renderer não tem permissões de Node.js e usa Context Isolation e Sandbox. Páginas externas são abertas no navegador do sistema. Profile e sessões ficam no diretório de dados do aplicativo do usuário. Consulte a [segurança de janelas e IPC](docs/architecture.md#window-and-ipc-security).

## Plataformas compatíveis

| Plataforma | Distribuição | Status |
| --- | --- | --- |
| macOS Apple Silicon | DMG/ZIP assinados e notarizados | Compatível |
| macOS Intel | DMG/ZIP assinados e notarizados | Compatível |
| Windows x64 | Instalador NSIS com assinatura de código | Compatível |
| Windows ARM64 | — | Ainda não compatível |
| Linux | — | Ainda não compatível |

O Harness inclui dependências nativas de cada plataforma; por isso, os instaladores oficiais são compilados no sistema operacional e na arquitetura correspondentes.

## Desenvolvimento e arquitetura

Contribuições são bem-vindas. A documentação técnica está organizada em:

- [Guia de desenvolvimento](docs/development.md) — ambiente local, validação, manutenção de patches e empacotamento nativo
- [Arquitetura de execução](docs/architecture.md) — inicialização, persistência, segurança, recuperação, telefone e atualizações
- [Guia de lançamento](docs/release-runbook.md) — assinatura e controles de versões oficiais
- [Formato de pacotes Preset](docs/preset-packages.md) — contrato portátil de Agent Preset

Antes de enviar alterações, execute `npm test`, `npm run typecheck` e `npm run build` e verifique os fluxos afetados do aplicativo. Não inclua chaves API reais em issues, logs, capturas de tela ou dados de teste.

## Comunidade

Para conversar sobre a base de desktop compartilhada, participe da [comunidade DSH Desktop no Discord](https://discord.gg/7Xgf3qe3Qp) ou escaneie o QR do grupo de WeChat abaixo.

<img src="docs/images/wechat-group-20260815.png" width="220" alt="QR do grupo de WeChat da comunidade DSH Desktop" />

## Licença

O DSH Desktop é de código aberto sob a [MIT License](LICENSE).

O DeepSeek Harness e suas dependências continuam sujeitos às respectivas licenças e regras de marcas dos projetos originais. O DSH Desktop é um aplicativo de desktop independente da comunidade.

## Clientes

O BISHENG atende empresas líderes de vários setores. Estes são alguns dos nossos clientes.

![HSBC, Bosch, Watsons, China Mobile, COFCO e Shougang Group](docs/images/bisheng-customer-logos-row-1.png)

![China Baowu, CICC, SINOSURE, PetroChina, ICBC e Bank of Chongqing](docs/images/bisheng-customer-logos-row-2.png)

![PowerChina, Huatai Securities, Huaxia Bank, Liaoning Financial Holdings, China Minsheng Bank e Longhua Capital](docs/images/bisheng-customer-logos-row-3.png)

![JSTI, China CITIC Bank, AVIVA-COFCO, BAIC Group, China Bond Rating e Administração Meteorológica da China](docs/images/bisheng-customer-logos-row-4.png)

## Consultas empresariais

Entre em contato para saber mais sobre implantação empresarial do BISHENG, integração do cliente de desktop, demonstrações do produto ou parcerias comerciais.

[Falar com a equipe BISHENG pelo formulário do Feishu](https://dataelem.feishu.cn/share/base/form/shrcnVow7GQwwKYEBCD41Bu5qoh)
