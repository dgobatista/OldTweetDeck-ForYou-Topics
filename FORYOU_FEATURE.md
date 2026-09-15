# Feed Algorítmico ("Para Você") + Timelines por Tópico no OldTweetDeck

Documento de continuidade do trabalho em andamento: adicionar ao OldTweetDeck colunas
que usam os feeds **algorítmicos/recomendados** do X (o "Para você" da home, e futuramente
os tópicos tipo Futebol/Anime/NFL do modal "Timelines"), em vez de só colunas cronológicas.

Leve este arquivo para o outro PC — ele contém tudo que já foi descoberto, o que já foi
implementado, o bug que está sendo investigado agora, e os próximos passos.

---

## 1. Contexto: como a extensão funciona

O OldTweetDeck **não é uma reimplementação** do TweetDeck — é um shim:

- `files/bundle.js` é o cliente TweetDeck legado original, vendorizado (76 mil linhas,
  minificado mas com identificadores legíveis). Ele é quem desenha toda a UI, colunas,
  modais etc. **Evitamos editar esse arquivo** porque não há build system/source maps
  para recompilá-lo — qualquer edição é manual e arriscada.
- `src/interception.js` é o único arquivo que a extensão de fato mantém. Ele faz
  `Proxy` do `XMLHttpRequest` global e intercepta as chamadas REST legadas que o
  `bundle.js` faz, redirecionando para a API GraphQL moderna do X e reformatando a
  resposta de volta no formato REST antigo que o bundle espera.

**Importante:** a interceptação só cobre `XMLHttpRequest`. Ela **não** intercepta
`fetch()`. Se em algum ponto descobrirmos que o `bundle.js` usa `fetch` para alguma
chamada específica, a estratégia de interceptação atual não vai funcionar para ela.

### Autenticação
Cookie-based: `ct0` (CSRF) lido via `document.cookie`, `xhr.withCredentials = true`
(cookies de sessão do X viajam automaticamente), bearer token público hardcoded em
`PUBLIC_TOKENS[0]` (topo de `interception.js`), mais um header anti-bot
`x-client-transaction-id` resolvido por `src/challenge.js`.

---

## 2. O que já foi implementado (Fase "For You")

Estratégia escolhida: **não mexer no `bundle.js`**. Em vez de criar um novo tipo de
coluna do zero (o que exigiria editar os enums `feedTypes`/`columnMetaTypes` em
`bundle.js:2153/2192` e a UI do modal "Choose a column type"), a coluna algorítmica é
disfarçada como uma **Lista** — o fluxo de "Add column → List" já existe, funciona, e
tem busca/paginação prontas.

### Como funciona
1. Quando o bundle pede `/1.1/lists/ownerships.json` ou `/1.1/lists/subscriptions.json`
   (chamadas que populam "Your Lists" no picker de colunas), a interceptação deixa a
   chamada real acontecer normalmente e **injeta uma entrada de lista falsa** no array
   de resposta: `🔮 Para Você (Algorítmico)`, com um ID reservado
   `900000000000001` (constante `FORYOU_LIST_ID`).
2. Quando o usuário adiciona essa "lista" como coluna, o bundle chama
   `/1.1/lists/statuses.json?list_id=900000000000001&...` normalmente.
3. A rota de `lists/statuses.json` detecta esse ID reservado e, em vez de montar uma
   query `ListLatestTweetsTimeline`, monta uma query `HomeTimeline` (o endpoint
   algorítmico real do "Para você" do X) e faz o parsing da resposta do jeito certo
   (estrutura `data.home.home_timeline_urt`, igual à coluna Home normal).
4. Paginação por cursor (scroll infinito / "carregar mais") reaproveita a mesma lógica
   já existente para Home/Listas, com namespace próprio (`foryou-*`) pra não colidir.

### Onde está o código
Tudo em `src/interception.js`:

- `FORYOU_LIST_ID` — constante do ID falso reservado
- `FORYOU_FAKE_USER` — usuário fictício "dono" da lista falsa (deliberadamente **não**
  usa o ID do usuário real — ver bug corrigido abaixo)
- `buildForYouList()` — monta o objeto de lista falsa no formato legado do Twitter
  (`id_str`, `name`, `slug`, `user`, etc.)
- `injectForYouList(xhr, wrapperKey)` — pega a resposta real (ou um array vazio se a
  chamada real falhar) e injeta a lista falsa nela
- 3 rotas novas no array `proxyRoutes`, logo antes do comentário `// List timeline`:
  - `/1.1/lists/ownerships.json` (GET) → `injectForYouList(xhr, "lists")`
  - `/1.1/lists/subscriptions.json` (GET) → `injectForYouList(xhr, "lists")`
  - `/1.1/lists/list.json` (GET) → `injectForYouList(xhr, null)`
- A rota `/1.1/lists/statuses.json` foi modificada: no `beforeRequest`, se
  `list_id === FORYOU_LIST_ID`, monta a URL do `HomeTimeline`
  (queryId `Dw2wl35E3OV4X6UlEAf0bg`) em vez do `ListLatestTweetsTimeline`; no
  `afterRequest`, se `xhr.storage.isForYou`, usa `parseHomeTimelineTweets(...)` em vez
  do parsing de lista.
- `parseHomeTimelineTweets(xhr, data, seenKey)` — função extraída/compartilhada com a
  lógica de parsing que a coluna Home já usa (entries, `home-conversation-`, cursors,
  filtro de anúncios/bloqueados etc.), parametrizada por uma `seenKey` própria pra não
  misturar o "já visto" da Home normal com o do For You.

### Bug já corrigido
A primeira versão usava o ID do usuário **real** (`getCurrentUserId()`) como "dono" da
lista falsa. Isso é perigoso: o `bundle.js`, ao processar qualquer usuário
(`TwitterUser.fromJSONObject`), sempre faz `TD.cache.twitterUsers.add(this)` **usando o
ID como chave** — ou seja, um usuário fake com o ID real do usuário logado sobrescreveria
o cache do perfil real dele (nome/avatar em branco) em outras partes da UI. Corrigido:
agora `FORYOU_FAKE_USER` tem um ID fixo e claramente falso (`id_str: "1"`,
`screen_name: "oldtweetdeck"`), sem qualquer chance de colidir com uma conta real.

### Também corrigido
O `queryId` hardcoded do `HomeLatestTimeline` (`/1.1/statuses/home_timeline.json`)
estava desatualizado no repositório original. Atualizado para
`iv-dlEyuey-JlgeP5u6rPw` (capturado ao vivo). **Isso confirma que o X gira esses
hashes de tempos em tempos** — qualquer queryId hardcoded vai quebrar de novo no
futuro, não é bug, é esperado.

---

## 3. Bug ATUAL em investigação: a lista falsa não aparece

### O que já foi descartado
- ❌ As chamadas `ownerships.json`/`subscriptions.json` não estão acontecendo — **elas
  acontecem**, status 200 confirmado no Network tab.
- ❌ Teste via `fetch()` manual reconstruindo os headers de auth: **inválido como
  teste** — a interceptação só faz patch de `XMLHttpRequest`, não de `fetch`. Uma
  chamada feita via `fetch()` nunca passa pelo proxy, então não prova nada sobre o
  comportamento real do `bundle.js` (que usa jQuery `$.ajax`, que por sua vez usa XHR).

### Teste que falta fazer (prioridade #1 no outro PC)
Isso decide entre duas hipóses completamente diferentes:

1. Recarregar a página do TweetDeck (F5) com DevTools Network aberto e **Preserve
   log** ativado.
2. Achar a linha `ownerships.json` (ou `subscriptions.json`) que aparece
   **automaticamente** no carregamento (a chamada real do bundle, não uma refeita à
   mão).
3. Clicar nela → aba **Response** (não Preview) → `Ctrl+F` → procurar
   `900000000000001`.

Alternativa mais fácil (evita ter que caçar a linha certa manualmente): colar isto no
Console **antes** de dar F5:

```js
(function(){
  const orig = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === "string" && /lists\/(ownerships|subscriptions|list)\.json/.test(url)) {
      this.addEventListener("load", () => console.log("[DEBUG]", url, this.responseText));
    }
    return orig.apply(this, arguments);
  };
})();
```

Depois dar F5 e olhar o que aparece logado no Console.

### Como interpretar o resultado

- **Se a string `900000000000001` NÃO aparecer no Response bruto da chamada real via
  XHR**: minha interceptação não está reescrevendo a resposta antes do bundle recebê-la.
  Possíveis causas a investigar, em ordem de suspeita:
  1. **O `bundle.js` pode estar usando `fetch()` para essas 3 chamadas específicas**
     (diferente de Home/List-tweets, que comprovadamente passam por XHR). Buscar no
     bundle por `fetch(` perto de `lists/ownerships` ou dentro do módulo de
     `TD.net.ajax` (`bundle.js` por volta da definição do módulo que contém
     `TD.net.ajax = i(131)`, linha ~17236). Se for isso, a interceptação precisa
     também dar `Proxy`/monkey-patch em `window.fetch`, não só em `XMLHttpRequest`.
  2. Erro de matching de rota: conferir se o `pathname` da URL bate exatamente com
     `/1.1/lists/ownerships.json` (ex: pode estar vindo com prefixo diferente, query
     string estranha, ou método diferente de GET).
  3. Erro de execução dentro de `injectForYouList` sendo engolido silenciosamente
     (checar console por erros ao carregar a página).

- **Se a string aparecer no Response bruto, mas a lista falsa não aparece na UI do
  seletor "Your Lists"**: a interceptação está funcionando, e o problema é que o
  `bundle.js` está descartando a entrada por alguma validação de formato. Nesse caso,
  o próximo passo é comparar campo a campo o objeto `buildForYouList()` (em
  `interception.js`) com um objeto de lista real do Response, e ajustar os campos que
  estiverem faltando ou em formato errado. Os pontos de validação relevantes no
  `bundle.js` são:
  - `TD.services.TwitterList.prototype.fromJSONObject` (~linha 41110): usa
    `e.id_str`, `e.name`, `e.description`, `e.slug`, `e.full_name`, `e.member_count`,
    `e.mode`, `e.user`.
  - `TD.services.TwitterUser.prototype.fromJSONObject` (~linha 40667): usa
    `e.id_str`, `e.screen_name`, `e.profile_image_url_https`, `e.name`, `e.created_at`
    (via `TD.util.parseDateString`), etc. — o código já tem `TD.util.isRetina() &&
    profileImageURL.replace(...)`, então `profile_image_url_https` **precisa ser uma
    string** (não `null`/`undefined`), senão quebra com `.replace is not a function`.
  - `TD.cache.lists.add` (~linha 30444, `t.add`) guarda por `e.account.getKey()` — como
    a lista é processada dentro do `TwitterClient` da conta certa
    (`this.oauth.account`), isso deve vir automático, mas vale conferir.
  - O picker "Add Column → List" (sem screenName, própria conta) usa
    `TD.cache.lists.getListsFor(accountKey)` sem filtro de `isOwnList()` — então
    `isOwnList()` retornar `false` (por causa do usuário fake) **não deveria** ser o
    motivo do sumiço.

---

## 4. Depois de resolver o bug: Fase 4 — Tópicos (Futebol, Anime, NFL...)

Ainda **falta capturar** o endpoint que carrega os **tweets de um tópico específico**
depois que ele é ativado no modal "Gerenciar timelines". Já temos:

- `PinnedTimelinesManagementSheetQuery` (queryId `9GXlcvTyuEyONW2ua63Zfw`, GET,
  `variables={}`) — lista os tópicos disponíveis, mas **não** o conteúdo/tweets deles.
- Outras chamadas vistas no caminho (não usadas ainda): `ExploreSidebar`
  (`XmC97nOWwOVJqArfD5SSqg`), `ViewerBadgeCounts` (`q4Npr1-FYRWyXsRzPckwEA`),
  `UsersByRestIds` (`BuQFwM7wpHl00cfHL-r0rA`).

### O que capturar
1. Abrir o modal, clicar em um tópico (ex: Futebol) pra ativá-lo.
2. Abrir a aba/timeline desse tópico já ativado.
3. No Network (filtro `graphql`), achar a chamada que carrega os tweets desse tópico
   — provavelmente algo como `TimelineTopicById`, `GenericTimelineById`, ou pode ser
   uma variação do próprio `HomeTimeline`/`ExploreSidebar` com um parâmetro de
   `topic_id`/`seed`. Copiar como cURL (ou exportar `.har`) e me mandar.
4. Rolar a timeline do tópico pra também capturar a paginação (cursor de "load more").

### Implementação prevista (mesma estratégia)
Cada tópico vira mais uma "lista falsa" (`buildForYouList`-style), com um ID reservado
próprio (ex: `900000000000010` = Futebol, `...011` = Anime, etc.), populada a partir da
resposta do `PinnedTimelinesManagementSheetQuery` (pra pegar os nomes/ícones reais dos
tópicos disponíveis dinamicamente, em vez de hardcodar), e a rota de
`lists/statuses.json` ganha mais um branch: se o `list_id` bater com um desses IDs
reservados de tópico, monta a query do endpoint de tópico descoberto na captura acima.

---

## 5. Riscos conhecidos (para ter em mente)

- **QueryIds do X mudam sem aviso.** Já aconteceu uma vez nesta sessão de trabalho
  (`HomeLatestTimeline` estava com ID desatualizado no repo). Cedo ou tarde
  `HomeTimeline` (`Dw2wl35E3OV4X6UlEAf0bg`) também vai virar e a coluna For You vai
  parar de funcionar até alguém recapturar o ID novo do jeito que fizemos aqui.
- **Endpoints v1.1 legados podem ser desativados pelo X a qualquer momento** sem aviso
  — o truque de "lista falsa" depende de `lists/ownerships.json` continuar existindo
  (mesmo que devolvendo dados via o bridge interno do X).
- **`bundle.js` não tem build system** — qualquer mudança nele é edição manual de
  texto minificado, alto risco de quebrar algo sem querer. Por isso a estratégia atual
  evita tocar nele.
- Nenhum teste automatizado existe no projeto (`package.json` só tem o script de
  empacotamento `pack.js`). Toda validação é manual, no navegador, com sessão real
  logada.

---

## 6. Checklist rápido pro outro PC

- [ ] Rodar `npm install` (falta o `adm-zip` do `pack.js`) e `npm run build` pra gerar
      o pacote atualizado, ou carregar a pasta descompactada direto em
      `chrome://extensions` (modo desenvolvedor → carregar sem compactação).
- [ ] Fazer o teste do item 3 (Response bruto de `ownerships.json`/`subscriptions.json`
      na chamada real, não via `fetch()` manual) e reportar o resultado.
- [ ] Se confirmar que é `fetch()` sendo usado por essas chamadas específicas, avisar
      — nesse caso a interceptação precisa ganhar um patch de `window.fetch` também.
- [ ] Depois de resolver, capturar o endpoint de conteúdo de tópico (Fase 4, item 4
      acima) pra eu poder implementar tópicos.
