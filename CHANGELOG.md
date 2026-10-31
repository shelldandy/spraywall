# Changelog

## [1.3.1](https://github.com/shelldandy/spraywall/compare/v1.3.0...v1.3.1) (2026-10-31)


### Bug Fixes

* address repository audit findings ([#58](https://github.com/shelldandy/spraywall/issues/58)) ([598db0c](https://github.com/shelldandy/spraywall/commit/598db0cb98da7f2f8f95700a28b71a20dd3f0cfa))

## [1.3.0](https://github.com/shelldandy/spraywall/compare/v1.2.0...v1.3.0) (2026-10-30)


### Features

* activity feed for climbs and walls ([#45](https://github.com/shelldandy/spraywall/issues/45)) ([4f16127](https://github.com/shelldandy/spraywall/commit/4f16127295e5f0c170d82fd6535bb2a8e7f7f3b0))
* add neobrutalist marketing site ([#51](https://github.com/shelldandy/spraywall/issues/51)) ([b42c09a](https://github.com/shelldandy/spraywall/commit/b42c09a03de41398ae083fe651cbf6cd889fce1c))
* beta videos on climbs ([#46](https://github.com/shelldandy/spraywall/issues/46)) ([3b01948](https://github.com/shelldandy/spraywall/commit/3b019485b93a0e33feb421e4ca4af5c8991a10ee))
* filter by beta video and sort by grade ([#48](https://github.com/shelldandy/spraywall/issues/48)) ([bba2706](https://github.com/shelldandy/spraywall/commit/bba270691151258e0f466dcfc8ecb97f56de4126))
* simplify climb list filters and sort controls ([#50](https://github.com/shelldandy/spraywall/issues/50)) ([e25d4e1](https://github.com/shelldandy/spraywall/commit/e25d4e19aeda3415b6a607a43ec90962e30d6002))
* **web:** allow deleting routes ([#54](https://github.com/shelldandy/spraywall/issues/54)) ([24a7596](https://github.com/shelldandy/spraywall/commit/24a75964f291c40d0fd607b6f528ed0cd51ef422))
* **worker:** migrate hold segmentation to SAM 2.1 ([#52](https://github.com/shelldandy/spraywall/issues/52)) ([313b009](https://github.com/shelldandy/spraywall/commit/313b0099d94596fd17087b480d71df1e9ae7a801))


### Bug Fixes

* declutter mobile wall and climb views ([#47](https://github.com/shelldandy/spraywall/issues/47)) ([e18cd49](https://github.com/shelldandy/spraywall/commit/e18cd49f3c5bf7a736c554fe6113c13f1d1f252f))
* harden detection and recovery flows ([#53](https://github.com/shelldandy/spraywall/issues/53)) ([17dd498](https://github.com/shelldandy/spraywall/commit/17dd498d3bfa799bf1681944139aa7d56ed3359b))
* pre-select surviving holds when editing archived climbs ([#42](https://github.com/shelldandy/spraywall/issues/42)) ([824bf4c](https://github.com/shelldandy/spraywall/commit/824bf4c0326183e1c09c672e1ca8dc951b1c1c27))
* use deterministic parent navigation ([#49](https://github.com/shelldandy/spraywall/issues/49)) ([2861460](https://github.com/shelldandy/spraywall/commit/2861460b0af00e4e298a5c9623276f5e5ac016bb))
* **web:** keep horizontal scroll inside beta videos strip ([#55](https://github.com/shelldandy/spraywall/issues/55)) ([1ad7cd1](https://github.com/shelldandy/spraywall/commit/1ad7cd13a1ea6bbf9335847490213282c6653f14))

## [1.2.0](https://github.com/shelldandy/spraywall/compare/v1.1.1...v1.2.0) (2026-10-25)


### Features

* improve partial reset review ([16c3d93](https://github.com/shelldandy/spraywall/commit/16c3d93ffbb8286cab64460d6359bb628954b3ef))
* **server:** support partial wall resets ([2cdb6b4](https://github.com/shelldandy/spraywall/commit/2cdb6b44e17b08d7ec9667bce8fa0df7dfb18b5f))
* support iterative partial wall resets ([60bb3f3](https://github.com/shelldandy/spraywall/commit/60bb3f342d320b07e155151f3c369a16252d9d9b))
* **web:** add bottom action navigation ([6c7e112](https://github.com/shelldandy/spraywall/commit/6c7e112da4200fc787adb6be9601b707d273f66a))
* **web:** add camera lens picker for partial resets ([471d5ad](https://github.com/shelldandy/spraywall/commit/471d5adc36d20c033bf7570346bdc559315c30cd))
* **web:** add partial wall reset workflow ([3c3cf18](https://github.com/shelldandy/spraywall/commit/3c3cf18c45982f07d91a898bd35487ecefa75e59))
* **web:** camera lens picker + tailnet HTTPS dev setup ([f20f4a8](https://github.com/shelldandy/spraywall/commit/f20f4a8395be48def8323cfd56d4dfc629180d98))
* **web:** use new app artwork for icons and branding ([cd88ef4](https://github.com/shelldandy/spraywall/commit/cd88ef4fc9e56e747b85b9c2ea612be7ae42faea))
* **web:** use new app artwork for icons and branding ([0eeeffc](https://github.com/shelldandy/spraywall/commit/0eeeffce771f32755f7079fe5a24e249fca204e8))
* **worker:** align and match holds for partial resets ([ce15b4f](https://github.com/shelldandy/spraywall/commit/ce15b4f68c67ea97c6522d67f4b5cfe5339fa191))


### Bug Fixes

* address partial reset review feedback ([5363ca1](https://github.com/shelldandy/spraywall/commit/5363ca1a3905dfd68cb9fec54d7e08c9feaf3bb4))
* **server:** continue when stale reset cleanup fails ([3acaba1](https://github.com/shelldandy/spraywall/commit/3acaba187dbf1e9283e4969fec27ee7cb0ea6bb6))
* **web:** keep action navigation inside auth routes ([0e4c6b6](https://github.com/shelldandy/spraywall/commit/0e4c6b637a29a679f2bfc17bbc42d07e87f5b97f))
* **web:** keep profile in the action tab bar ([8a032b7](https://github.com/shelldandy/spraywall/commit/8a032b7c5c70437bbf08d7b49bfb70282302fe8d))
* **web:** make iOS home-screen icon full bleed ([b804254](https://github.com/shelldandy/spraywall/commit/b804254cd7e38791bf457985029e2ccf7fe79650))
* **web:** make iOS home-screen icon full bleed ([2eb38b2](https://github.com/shelldandy/spraywall/commit/2eb38b22f18f35a563e0f15227c7ee9c8d82c65a))
* **web:** match flattened icons to the dark app background ([18fa283](https://github.com/shelldandy/spraywall/commit/18fa2834183e1e871f0358993a052fdb6ddd5fa2))
* **web:** repair iOS PWA camera lens switching ([f7b5efd](https://github.com/shelldandy/spraywall/commit/f7b5efd688c00fa1f08160b89d836b0fe1b6ef32))
* **web:** retain explicit rear camera lens ([7d32bf2](https://github.com/shelldandy/spraywall/commit/7d32bf26cc830e727eed3ccec91f90bdc8191f11))
* **web:** scope action nav spacing to visible routes ([80b77e4](https://github.com/shelldandy/spraywall/commit/80b77e4a5e63576fd2b6dacf28954ec800ba9213))
* **web:** show iOS PWA camera preview and capture full-size frames ([85fd63d](https://github.com/shelldandy/spraywall/commit/85fd63debef80fb40132c455f94da86e6949d77e))
* **web:** show iOS PWA camera preview and capture full-size frames ([d3b871c](https://github.com/shelldandy/spraywall/commit/d3b871cef7888fded00d0ae40b19c1bf5366b0da))
* **web:** update circuits after visiting a wall ([d5ed95b](https://github.com/shelldandy/spraywall/commit/d5ed95bf829ca6fa2d1a3253bb08598150d8cc77))

## [1.1.1](https://github.com/shelldandy/spraywall/compare/v1.1.0...v1.1.1) (2026-10-21)


### Bug Fixes

* omit empty image build args ([9e95823](https://github.com/shelldandy/spraywall/commit/9e95823652bb804bed975c89d25a5a3dbef41cbf))
* show actual app version in Settings ([5d043fe](https://github.com/shelldandy/spraywall/commit/5d043fe3eb1c8da8bd1db2159411b33e4724fb4a))
* show app version in settings ([8c7b5bc](https://github.com/shelldandy/spraywall/commit/8c7b5bc1c9a20c95ab7d23a69886cf424edadc79))

## [1.1.0](https://github.com/shelldandy/spraywall/compare/v1.0.0...v1.1.0) (2026-10-21)


### Features

* add climb logging, ratings, and filters ([9915a3a](https://github.com/shelldandy/spraywall/commit/9915a3af6cb6265b6480da52c0b8463b6cc994b9))
* add climb logging, ratings, and filters ([07e1ee4](https://github.com/shelldandy/spraywall/commit/07e1ee4980b2201a756b98a0dbf87cc4fcf37c32))
* add route style tags and filters ([88c0907](https://github.com/shelldandy/spraywall/commit/88c0907cd21046e121a3993b10eae2cd204815d7))
* **circuits:** add color and emoji styles ([d884785](https://github.com/shelldandy/spraywall/commit/d884785f5f96358cacc375de7bef0be52ec81943))
* **web:** add route circuits ([09abf2a](https://github.com/shelldandy/spraywall/commit/09abf2a13ab172c2334b2fd98ac008faf78b6ca6))
* **web:** color grade picker and logbook labels ([4e35d42](https://github.com/shelldandy/spraywall/commit/4e35d42bb11350f0ef1afa63198a9f39b5784034))
* **web:** filter routes by grade range ([a681119](https://github.com/shelldandy/spraywall/commit/a681119fd0912fdc07aa77b1f92b0f7b6121462b))
* **web:** random route name generator on create route ([63592aa](https://github.com/shelldandy/spraywall/commit/63592aa231a7b116e958ec2986d9e7e99512420e))
* **web:** refine route detail and grade colors ([f309716](https://github.com/shelldandy/spraywall/commit/f3097162b14bdf59ad3a365c7ffb805a193d382f))
* **web:** refine route detail and grade colors ([3e0be47](https://github.com/shelldandy/spraywall/commit/3e0be47748c8b68013f9e86856d3c76d0da68a5b))


### Bug Fixes

* **circuits:** address review findings ([ea06203](https://github.com/shelldandy/spraywall/commit/ea062030145914bf09cc6e083f56e5ec7702966e))
* **circuits:** preserve hidden routes on reorder ([b8a11df](https://github.com/shelldandy/spraywall/commit/b8a11df4cee685441dc1cbc40d6d5d0a4188032e))
* **web:** complete circuit workflows ([e71154c](https://github.com/shelldandy/spraywall/commit/e71154cddbfb977b52f9ed9f36814f5748310902))

## 1.0.0 (2026-10-16)


### Features

* add confidence threshold filter to wall detail screen ([bc0d24b](https://github.com/shelldandy/spraywall/commit/bc0d24b20fc61452e2bcd433840c1188d094053e))
* add draft routes — save WIP routes visible only to creator ([c8c925a](https://github.com/shelldandy/spraywall/commit/c8c925afb52e93b9d5ce58857b0d408b213b0bab))
* add gym and wall deletion with confirmation dialogs ([1c11401](https://github.com/shelldandy/spraywall/commit/1c114010aefdc56ddb9cf329c6330a9182604b44))
* add hold roles (start/finish/normal) with color-coded overlay ([5fe9b5c](https://github.com/shelldandy/spraywall/commit/5fe9b5cefd6050e5262bb8840b191f4a5d55a50f))
* add local-first SQLite database with offline sync ([c0a0a89](https://github.com/shelldandy/spraywall/commit/c0a0a89c151e2f909bb4bd6695a425f687cdfc7a))
* add Modal inference and Expo app/tooling updates ([8a41a6f](https://github.com/shelldandy/spraywall/commit/8a41a6f57e5eb2ff50600c6a7e6fa4c70b8e8754))
* add Modal serverless GPU backend for hold detection ([f43342b](https://github.com/shelldandy/spraywall/commit/f43342b3d1bcd65199820d688a5bc15c11227638))
* add pinch-zoom and pan for wall images ([92c55c6](https://github.com/shelldandy/spraywall/commit/92c55c6a9205ef769d28d9b9394797fcb9b9068f))
* add server-side SAM segmentation as post-YOLO step ([5c0dae8](https://github.com/shelldandy/spraywall/commit/5c0dae801efe2b3186877df5ff9917077b36bc76))
* add users table migration and sqlc queries ([0fd93ca](https://github.com/shelldandy/spraywall/commit/0fd93ca1b74f753ce3063378ac61f1dcf8cac9b3))
* allow setters/admins to add and delete holds after detection ([01862d5](https://github.com/shelldandy/spraywall/commit/01862d5d99434c73e081f9492f1831e81cf6f7e9))
* auto-poll detection status and fetch wall detail from server ([f870d20](https://github.com/shelldandy/spraywall/commit/f870d20d8c0e4b03129539f06c455c6fa5bf7848))
* close MVP gaps — wall reset UX, role-based UI gating, settings validation, lint/test wiring ([67ce1dc](https://github.com/shelldandy/spraywall/commit/67ce1dcf795f7f62e60d64ccba754fd15111fa18))
* confidence threshold filter for holds ([1825c3e](https://github.com/shelldandy/spraywall/commit/1825c3ed8f04ce4604b9ddf75ab78bf3036f6f32))
* draft routes with publish workflow ([48f3ce4](https://github.com/shelldandy/spraywall/commit/48f3ce44d3c9b65bda7b2ff869ba514979003c39))
* edit holds after detection ([c8c95db](https://github.com/shelldandy/spraywall/commit/c8c95db79d619ffa6919a100ac133f9abbf648a1))
* edit route navigates to wall for hold re-selection ([98d8035](https://github.com/shelldandy/spraywall/commit/98d80350e6d35f8725c8b53923145993d20442dc))
* hold roles, color coding, and dark overlay ([442e0df](https://github.com/shelldandy/spraywall/commit/442e0dff244b3fd07c72ec93afa03a0725c78d5a))
* implement MVP phases 1-6 ([317ed06](https://github.com/shelldandy/spraywall/commit/317ed06cf2608122710c0e153a13746bd4ba6e34))
* implement Phase 2 auth, OpenAPI spec, and app auth screens ([8ce02cb](https://github.com/shelldandy/spraywall/commit/8ce02cb1e3d377c6ad38ecc95cdd8bcca3af44aa))
* implement Phase 3 gyms/walls, Phase 4 hold detection, and worker pipeline ([6bcd17e](https://github.com/shelldandy/spraywall/commit/6bcd17e0add5369c43d63f6b325096722d76dde8))
* implement Phase 5 routes, sends, and logbook ([31f546d](https://github.com/shelldandy/spraywall/commit/31f546d883b9520abfa4aa29f59df5a718027fcb))
* implement Phase 6 invites, nginx, rate limiting, and polish ([da03e2c](https://github.com/shelldandy/spraywall/commit/da03e2caf327f87e9bef30f691296d9328c79207))
* improve sync status bar UX and add pull-to-refresh ([1e42859](https://github.com/shelldandy/spraywall/commit/1e4285953b71baca24e182528195a1bed09d210e))
* local-first SQLite with offline sync ([44923a2](https://github.com/shelldandy/spraywall/commit/44923a225fd9c6fdf3741ee87e20cffb938b9b28))
* pan/zoom for wall images ([1320c87](https://github.com/shelldandy/spraywall/commit/1320c874d7d16256e4d993248ab1843fabdef643))
* polygon-based hold rendering with rect fallback ([68dfb7c](https://github.com/shelldandy/spraywall/commit/68dfb7c62ed139a589907b119a521b3237ab9e04))
* publish releases with release-please ([9ae8fc9](https://github.com/shelldandy/spraywall/commit/9ae8fc9e2757b2734fbe8ae03052ad4cdb672be8))
* publish releases with release-please ([acd1bbe](https://github.com/shelldandy/spraywall/commit/acd1bbe3eebad9a97c87423ebdac1a8eee16830a))
* render holds as polygons when polygon data is available ([3caf65d](https://github.com/shelldandy/spraywall/commit/3caf65d3d42b48fbba8542efb9a9a116c5a9aa88))
* replace free-text grade input with structured grade picker ([2a4b4f5](https://github.com/shelldandy/spraywall/commit/2a4b4f54f5fec4efa315ba5174174872cf631c44))
* route view colors, edit route, SAM dev tooling ([45f948e](https://github.com/shelldandy/spraywall/commit/45f948e6eee2096c1ed85568f5e5e5b77548984a))
* scaffold monorepo skeleton ([4568b55](https://github.com/shelldandy/spraywall/commit/4568b55c81a89fef68ff5a1de1da3cd924ceb8f3))
* scaffold monorepo with Go server, Python worker, Expo app, and Docker Compose ([5f77c63](https://github.com/shelldandy/spraywall/commit/5f77c63e5f4dfdfd9d472aa650e37b8c45e8042f))
* server-side SAM segmentation (optional) ([b972efa](https://github.com/shelldandy/spraywall/commit/b972efaf6e99c170a1c2a5492ea6425158853d0c))
* show Save Draft / Publish buttons in route editor ([21ce61a](https://github.com/shelldandy/spraywall/commit/21ce61ae0194febaf4daefe03d523b957b09a742))
* structured grade system with picker ([a2d1b7a](https://github.com/shelldandy/spraywall/commit/a2d1b7ae8c600847b7008138a76fbf22a62155d7))
* swipe-to-delete for gyms and walls ([cf5b84d](https://github.com/shelldandy/spraywall/commit/cf5b84d2661dc66ef710eaae357da2552346df43))
* **web:** apply plum and cyan theme app-wide ([0a5702f](https://github.com/shelldandy/spraywall/commit/0a5702fada5310b1544dee29c00c76f1e26d62e4))
* **web:** downscale photos before upload to stay under the server limit ([b39bcf2](https://github.com/shelldandy/spraywall/commit/b39bcf2eeca9ce52e99ec379059e013bae4a843e))
* **web:** port auth, walls list, settings, logbook and invite screens ([148e056](https://github.com/shelldandy/spraywall/commit/148e056158d39c67d29cdb7551318092ef960292))
* **web:** port HoldOverlay and add zoomable WallImage ([e4cc5f1](https://github.com/shelldandy/spraywall/commit/e4cc5f13926c8c207fcb2c7288fae763d9ceea01))
* **web:** port route list, detail and create screens ([bfd2c21](https://github.com/shelldandy/spraywall/commit/bfd2c21cf8652495adeac8cca912f2df2b444841))
* **web:** port wall detail screen ([077ec80](https://github.com/shelldandy/spraywall/commit/077ec809ca89860999f814f04c8600c4191ea236))
* **web:** scaffold Vite + React PWA with shared data layer ([f895e77](https://github.com/shelldandy/spraywall/commit/f895e77f5ab0e2df0577ee4cd8197c43630e61d9))
* **worker:** enable SAM hold outlines by default ([a77ad36](https://github.com/shelldandy/spraywall/commit/a77ad36b80f1617cf96c3f4798685aaac8b55453))
* **worker:** enable SAM hold outlines by default ([abb7261](https://github.com/shelldandy/spraywall/commit/abb72615fe79ced6b86bba35299a4bc6bcb4660e))


### Bug Fixes

* add Enter key submission to all forms for web ([7a5a7d7](https://github.com/shelldandy/spraywall/commit/7a5a7d7ab45ecf37a3f1f27437bdcf5769ceb41d))
* add logging to SAM segmentation pipeline for debugging ([4df7850](https://github.com/shelldandy/spraywall/commit/4df785037fc6b52beacde67620d4d901962745ed))
* address all 26 PR review comments ([2e45a76](https://github.com/shelldandy/spraywall/commit/2e45a763432c3c5c86e77ac0c976fe17b7d5dac4))
* address PR review feedback — 7 issues ([6920e67](https://github.com/shelldandy/spraywall/commit/6920e67f7e743c0085c59135f375271ef4da2f5b))
* address PR review feedback for hold detection ([452125b](https://github.com/shelldandy/spraywall/commit/452125bda614a82cc6cb89bd3a0ff712cc4602d0))
* address PR review feedback for hold editing ([0b8bbc1](https://github.com/shelldandy/spraywall/commit/0b8bbc13064b175460da5a43263107c59c1663fa))
* address PR review feedback for local-first sync ([5b5628f](https://github.com/shelldandy/spraywall/commit/5b5628fa883ad251fd4ae8c4c2f0764617a5a565))
* address PR review feedback for local-first sync ([e1c7b3f](https://github.com/shelldandy/spraywall/commit/e1c7b3f36b59e6f01394430c1eeb64020bc568f7))
* address PR review feedback from Copilot bot ([83c2cbb](https://github.com/shelldandy/spraywall/commit/83c2cbbb9d0d3833aa8cb04f55226087596b298a))
* address PR review findings ([5d48318](https://github.com/shelldandy/spraywall/commit/5d48318eefe55f39b88af6323efd70522ac4d04b))
* address PWA PR review findings ([d0929c7](https://github.com/shelldandy/spraywall/commit/d0929c78ab6de16db32b8446500aafd703a621ef))
* address unresolved PR review feedback for local-first sync ([43ebf4d](https://github.com/shelldandy/spraywall/commit/43ebf4dda0424661d7ea863c64a9ff512d838ead))
* align Phase 1 scaffolding with spec ([cc9b4d7](https://github.com/shelldandy/spraywall/commit/cc9b4d74fa8dddf52ca3df07b3b24378b2602fe2))
* cascade delete children in local SQLite before deleting gym/wall ([8439bdf](https://github.com/shelldandy/spraywall/commit/8439bdfc5a89f9a693b63b39c4cdae18c994e4a4))
* convert uploaded images to JPEG before detection ([0a54d89](https://github.com/shelldandy/spraywall/commit/0a54d89dde82b87833f64ad020d4c28a7c36ce6f))
* create form tweals ([b06c18d](https://github.com/shelldandy/spraywall/commit/b06c18dd5788440d6e70918a573022a495c4efe1))
* enforce image limits and sync hold deletions ([cab129e](https://github.com/shelldandy/spraywall/commit/cab129e48af0ebc2f6559e9ef5822dfb0595e4c0))
* gitignore .pth model files, add SAM docs to README ([38eda39](https://github.com/shelldandy/spraywall/commit/38eda39a9d1e83892f71e3421ebba9dc7237f151))
* handle GetActiveWallImage errors, validate healthz response, fix test masking ([f6b8698](https://github.com/shelldandy/spraywall/commit/f6b869894825d5b60107a6f5245ae261db6a047a))
* improve hold detection accuracy and fix EXIF orientation ([ab4962f](https://github.com/shelldandy/spraywall/commit/ab4962f0c601d073235e1cae2cafd6e49cb462ea))
* improve hold detection accuracy and fix EXIF orientation ([daad5ef](https://github.com/shelldandy/spraywall/commit/daad5ef6145197fe52df9d5d8ab3376642561018))
* lazy-load expo-sqlite to avoid WASM error on web ([1fbb570](https://github.com/shelldandy/spraywall/commit/1fbb5700cc9975f415aec178bf9be4de86f97459))
* make migrate uses dev compose files and shell expansion ([fbb2349](https://github.com/shelldandy/spraywall/commit/fbb2349095b3ca7fb52b563676288294e3eac7ec))
* **nginx:** serve web manifest as application/manifest+json ([61ae6e0](https://github.com/shelldandy/spraywall/commit/61ae6e03ca8487e9b516eb61a3fc35fb0aba3535))
* persist login session across app restarts ([771da35](https://github.com/shelldandy/spraywall/commit/771da35e6ba68958f9447aa2995739a61c47ca23))
* prepend serverUrl to image path in route detail view ([017450e](https://github.com/shelldandy/spraywall/commit/017450e02a19ff3757dfbe33c78540c519e600ce))
* proxy images through server instead of presigned URLs ([284e0f3](https://github.com/shelldandy/spraywall/commit/284e0f3322918033c34b6d446cee5072c354fe90))
* remove dead code, fix autocommit rollback bug, and clean up scaffold ([584e16c](https://github.com/shelldandy/spraywall/commit/584e16c5f3163691866fc3e44c24fe1b8ace92f8))
* replace deprecated SafeAreaView with react-native-safe-area-context ([a3536ef](https://github.com/shelldandy/spraywall/commit/a3536ef2c03cac1568551346c3782f8b3411653c))
* resolve Docker build failures in make dev ([8442cc9](https://github.com/shelldandy/spraywall/commit/8442cc9d79d5feefd539b2d6c9244f569c3b4630))
* resolve Expo connect issues with Metro ESM and CORS ([801c77d](https://github.com/shelldandy/spraywall/commit/801c77dbc2d57b55f2df8c5d4bdacb0007387cac))
* show secondary grade system as disambiguator in grade picker ([35df0f6](https://github.com/shelldandy/spraywall/commit/35df0f687c6d0062c2a95aa5713ab2f42a33bd12))
* suppress react-native-svg responder warnings on web ([f3d7e29](https://github.com/shelldandy/spraywall/commit/f3d7e2925c53aaf05fbc79146cc9f2b67019d6dc))
* treat 404 as success when deleting gym/wall ([167990f](https://github.com/shelldandy/spraywall/commit/167990f9b5cb3dcbe97eb420ab74927fa0a10616))
* use onPress for SVG hold click handling on web ([7932f6e](https://github.com/shelldandy/spraywall/commit/7932f6e9a2eddaf74b8cf48af0cd806b4db54863))
* use platform-specific files to exclude expo-sqlite from web bundle ([9f330c0](https://github.com/shelldandy/spraywall/commit/9f330c093f38ddc1fa9fa699085a39ed037b778c))
* use visible selected holds count when confidence threshold filters holds ([50553c7](https://github.com/shelldandy/spraywall/commit/50553c72c9d9aabc7f9a0c67ee2d936638f24c60))
* web image upload, presigned URLs, hold serialization, and nav guard ([46c788d](https://github.com/shelldandy/spraywall/commit/46c788d66db4a9f0006178f718c3302cdc758728))
* **web:** show cached data offline and readable network errors ([d54d9fa](https://github.com/shelldandy/spraywall/commit/d54d9fa0b184e19d51d4f045d2ef285616c425f7))
