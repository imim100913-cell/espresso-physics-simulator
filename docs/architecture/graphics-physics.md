# Espresso Lab：グラフィックスと物理レンダリングの刷新設計

この設計の基準は「見た目」「計算の正しさ」「スマホでの応答性」を別々に検証し、合格したものを統合することです。今回の実装で商用品質や実機との一致を認定したものではありません。高品質なCADアセット、計測に基づく校正、複数の実機GPUでの検証はリリース条件として残します。「世界初」という主張も、先行製品の調査なしには採用しません。

今回の変更は、先に公開した3ステップのモバイルUIを保ち、3D表示とその接続部分を更新します。解析グラフ・レシピ・抽出後のレポートは同じショットデータを使います。以前のダークな3列UIに戻す変更ではありません。

## 実装状況（v4.2）

大規模GPUソルバーを公開画面へ接続しました。[実装・単位・検証・近似の詳細](gpu-solver.md) を参照してください。以下のGLSL解説は簡易モードの外観描画にも引き続き使われます。

| 項目       | 動く実装                                                                              | 残る検証・開発                                |
| ---------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| 粉体       | WebGPU MLS-MPM、APIC、SVD＋Drucker–Prager、重力・壁・タンパー接触、最大50万計算点     | WDT、豆の破砕、実測構成則、解像度収束         |
| 湿潤・溶出 | 密度から空隙率・透水係数、毛管圧／Darcy、保存型輸送、有限溶出、双方向抗力             | 非線形圧力収束、侵食、校正                    |
| 液流・SSFR | XPBD密度、粘性・凝集、カップ接触・回収、GPU storage直接描画、深度・厚み・Beer–Lambert | 底面液膜、気泡、接触角、マウステール再現性    |
| 断面・造形 | 閉じた旋盤形状、ステンシルキャップ、微細孔底板、螺旋刃、溝のある豆                    | CAD計測資産・公差                             |
| 光学       | PBR、環境、異方性、クリアコート、SSR/SSAO/Bloom/DoF、手続き的クレマ・湯気             | GPU粒子を含む共通HDR G-buffer、気泡の数値解法 |
| レポート   | GPUで回収した液体・溶質からTDS／EY、同じ試行の表・グラフ                              | 味・点数は参考予測。物性値は未校正            |

## 1. 全体設計図

```mermaid
flowchart TD
  UI[モバイルUI・レシピ設定] --> Shot[ショット状態と固定された設定]
  Shot --> Current[簡易モード: 抽出モデル]
  Shot --> Bound[SI単位の境界条件: 圧力Pa・温度K・タンパー変位m]
  Bound --> MPM[WebGPU: 乾燥粉体 MLS-MPM / Drucker–Prager]
  MPM <--> Porous[多孔質体: 圧力・飽和度・溶質の有限体積法]
  Porous <--> Free[自由液面: XPBD / 粘性 / 表面張力]
  MPM --> GPU[GPU常駐の変形・粒子・密度]
  Porous --> GPU
  Free --> GPU
  Current --> Adapter[現在の描画アダプター: 時刻・流量・濃度・抽出量]
  GPU --> Adapter
  Adapter --> Bed[連続ベッド・湿潤・断面]
  Adapter --> Fluid[簡易: 動的ストランド / GPU: SSFR]
  CAD[検証済みglTF / 精密プロシージャル] --> PBR[PBR・環境反射・ライティング]
  Bed --> PBR
  Fluid --> PBR
  PBR --> Beauty[線形HDR描画・ステンシル対応ターゲット]
  Beauty --> FX[画質別: SSR → SSAO → Bloom → DoF]
  FX --> Output[ACES表示変換・sRGB出力は最後に1回]
  Current --> Report[数値・グラフ・レポート]
  Free --> Report
```

### 更新周期と所有権

- UI／カメラ、物理時間、描画時間を分けます。描画が遅れたことを「質量が消えた」ことにしません。物理側は固定時間刻みまたは適応サブステップを使い、描画は状態を補間します。
- 現在の3D描画は標準30fps、省電力24fpsの上限。画面の数値とグラフの更新ループは独立しています。これは実機で30/60fpsを保証する値ではありません。
- 状態の正本はショットまたは検証済みソルバーが所有します。レンダラーからTDS・EY・スコアを逆算しません。
- GPUソルバーの粒子位置・変形勾配・飽和度はGPUに常駐。GPU→CPU読み戻しは低頻度の診断集計に限定し、毎フレーム50万粒子をJavaScriptへ戻しません。
- WebGLのカスタムGLSL／`onBeforeCompile`はWebGPURendererへそのまま移植できません。共有するのは状態と数式で、WebGPU側ではTSLのNodeMaterialまたはWGSLで再実装します。

### 品質の分岐

| モード | 対象                   | 今回の構成                                                                  |
| ------ | ---------------------- | --------------------------------------------------------------------------- |
| 省電力 | 長時間操作・低性能端末 | DPR最大1、24fps上限、PMREM、ポスト効果なし、動的な影なし                    |
| 標準   | スマホの既定           | DPR最大1.25（大画面1.75）、30fps上限、影、断面、微粒子、液流                |
| シネマ | 外観観察・高性能端末   | SSR、SSAO、弱いBloom、浅いDoF。断面中はSSR/SSAO/DoFを止め内部の可読性を維持 |

通常のSSAOPassやBokehPassは材質を一括置換するため、変形ベッド・ステンシル用メッシュ・切断キャップを正しいG-bufferに自動では出しません。今回の断面モードでこれらを無条件に重ねないのはそのためです。商用版では色・法線・深度・object/material IDの全パスで同じ変形／clip／capを適用する専用G-bufferを作り、断面にもAOとDoFを戻します。SSRは画面外の物体を反射できないため、PMREMやローカル反射プローブと併用します。

## 2. カッタウェイ・圧密・湿潤シェーダー

### ステンシルの処理順

`src/render/cutaway.js` が実装です。

1. ソリッドは厚みを持った閉じた形状にします。単なる片面の筒を「切断」しても、切断面は定義できません。
2. 色と深度を書かず、クリップされた背面をIncrementWrap、前面をDecrementWrapで描きます。
3. 本体を同じクリッピングプレーンで描きます。
4. ステンシルが0でない場所だけ切断平面のキャップを描き、深度を書きます。
5. ソリッドごとにステンシルをクリアします。部品Aの巻数で部品Bのキャップを塗らないようにします。

WebGLRendererとEffectComposerのターゲットには `stencil: true` / `stencilBuffer: true` が必要です。切断平面はモデル座標と混同しません。現在はワールドの `z=0` に固定し、バスケット・ヘッド・粉体はY方向だけ移動します。任意回転するCAD部品では平面を各ローカル座標系に変換する処理が必要です。

```js
const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const section = capSolid({
  parent: scene,
  geometry: closedBasketGeometry,
  material: chrome,
  plane,
  capGeometry: sectionPlaneGeometry,
  capMaterial: brushedCutSurface,
  order: 20,
});
section.setEnabled(true);
```

### ベッドの連続表面

`src/render/shaders.js` の `powderMaterial`、`powderDepth`、`microPowderMaterial` を使います。体積を埋める基体を描き、表面微粒子は質感のために重ねます。微粒子でバスケットを埋めようとしません。

現在の表示用高さは、投入率 `f`、圧密度 `c`、中心からの距離 `r` に対して、次の連続式です。

\[
h(r)=f\{h_0+0.14(1-c)(1-r^2/R^2)\}(1-0.24c)
\]

この式は「山ができ、押すと平らになる」視覚モデルです。物理的な質量・体積・空隙率はまだこの形状変形から求めません。商用モデルでは乾燥固体質量を固定し、\(V_{bed}=m_{dry}/[\rho_{solid}(1-\phi)]\) から高さを求め、塑性による空隙率変化を共有します。タンピング圧のNまたはPaへの変換には接触面積を使い、kgfをそのまま応力にしません。

変形は色だけでなく、頂点法線・影用DepthMaterial・ステンシルの前後面にも同じ関数で適用しています。トップが変形しているのに影だけ円柱、という不整合を防ぎます。

### 湿潤と抽出の表示

GLSLでは、上面からの正規化深さと前線位置を比較し、乾燥／湿潤の拡散色・粗さを滑らかに混合します。局所経路では前線を先行させ、表示上のチャネリングを示します。公開画面では前線位置をカップの流出量から近似しており、毛管浸透の解ではありません。飽和度を実測したかのような数値ラベルにはしません。

```glsl
float depth = (localTop - p.y) / max(localTop, 0.001);
float front = uWet * (1.45 + channel(p.xz) * 0.65) - 0.08;
float saturation = smoothstep(depth - 0.06, depth + 0.06, front);
diffuseColor.rgb = mix(dryColor, wetColor, saturation);
roughnessFactor = mix(0.98, 0.56, saturation);
```

将来の入力はGPUの `S(x)` と `C(x)` です。描画だけで経路を捏造する代わりに、局所透水係数・飽和度・溶質濃度の3Dテクスチャまたはストレージバッファをサンプルします。チャネルは「色の明るい線」ではなく、構造変化と高い局所流束に対応させます。

## 3. 滴下・合流・クレマ・SSFR

### 今回の動的液流

`src/render/fluid.js` が公開画面の実装です。最大5本、軸方向28区間×周方向10点のストランドを更新します。初期はボトムレス底面の複数点から滴下し、流量と圧力が増えると中心ストランドへ描画上の流量配分を移します。

半径は `Q = A v` と重力による速度増加の形を使って下に向かって細くします。表示座標は1 unit ≈ 5 cmとして扱い、g/sからの換算は描画係数を含みます。したがって、これを検証済みのNavier–Stokes解と扱いません。ゼロ流量ではストランドも滴も描きません。

液体材質には `MeshPhysicalMaterial` の透過・厚み・吸収を使用します。濃度の高い初期は暗く、後半は薄い色に変わります。濃度に応じて `attenuationDistance` を変えます。色を塗ることと体積吸収は別の操作です。

### SSFR実装例

`src/render/ssfr.js` はGPU粒子の位置を受け取る独立した参照実装です。現在のストランド描画をSSFRと呼んでいません。

```js
const surface = new ScreenSpaceFluid(width, height, {
  radius: 0.018,
  metersPerUnit: 0.05,
});
const fluidTexture = surface.render(
  renderer,
  particlePositions,
  particleCount,
  opaqueColorTexture,
  opaqueDepthTexture,
  camera,
  cupTDS,
);
// fluidTexture は線形色。必要な合成後、OutputPassで表示変換する。
```

パスの順序は次の通りです。

1. 粒子を球のインポスターとして描き、球面の手前の線形視点深度をRGBA16FのR成分に記録。球面の投影深度を `gl_FragDepth` にも書いて手前を選びます。
2. 厚みを別ターゲットへ加算ブレンド。単一球なら \(\ell=2r\sqrt{1-x^2-y^2}\) 。重複する粒子の厚みをそのまま加える方法は過剰吸収の原因になるため、本番では局所体積率による補正が必要です。
3. 深度を横→縦のバイラテラルで平滑化。深度差が大きい別の面を混ぜず、背景の0深度を除外します。
4. 逆射影と隣接ピクセルの位置差から法線を再構築します。輪郭での不安定さは、本番では左右／上下のうち深度差が小さい方の差分を選び改善します。
5. 不透明シーンの深度と比較し、金属やカップの裏側の液体を隠します。スクリーン空間オフセットで屈折を近似します。
6. Fresnel反射と透過光を合成します。実装例は一定色の環境反射を使い、本番ではPMREM／反射プローブへ置き換えます。

Beer–Lambertは線形RGBで

\[
T(\lambda)=\exp[-\sigma_a(\lambda,C)\ell],\quad
L_o=F L_{reflection}+(1-F)T L_{refracted}
\]

です。`sigma_a` はm⁻¹、`ell` はm。TDSの質量分率を「%表記の10」のまま別の式へ混ぜないよう境界で換算します。実装例のRGB吸収係数 `(200,650,1200) m⁻¹ @ TDS10%` は演出用の仮値です。分光測定なしに、実物のエスプレッソの吸収係数とは主張しません。

### クレマの段階

現在はカップの実際の推定抽出量に応じて液面を上げ、Worleyノイズを流線座標で移流する材質を描きます。湯気はソフトな半透明スプライトです。画面に青い球体を表示しません。

本番の微泡モデルは次の順序にします。

- 豆の鮮度・焙煎度から残存CO₂を校正し、圧力低下による核生成率を推定。
- 低解像度の泡密度／泡径分布を液面グリッドで移流し、合体・排液・破裂を反応項として更新。
- 小泡は法線・粗さ・薄膜散乱へ、大きな泡だけ幾何へ昇格。
- タイガーストライプは外部から流入する油分・微粉・泡密度の差として移流。単なる時間ノイズとの違いを校正。

93℃だから必ず濃い湯気が見えるわけではありません。室温・湿度・照明依存をパラメータ化し、過剰な白煙で液流を隠さないようにします。

## 4. 精密造形・PBR・ポスト処理の統合

### プロシージャル造形

`src/render/geometry.js` に実装しています。

- `turned(profile)`：内外面を含む旋盤断面を回転。バスケットの巻き縁、段付きのヘッド、陶器の肉厚、金属フェルールを作ります。
- `roundedProfile`：円弧で面取りの断面を作成。円柱に金属色を付けただけの輪郭を避けます。
- `perforatedPlate`：Shapeの穴をExtrudeし、底面と孔壁を持つ実形状にします。ベッドはこの底板の上に置き、宙に浮かせません。
- `spiralBurr`：半径に応じたねじれと、両側の斜面・細い刃先を持つ歯を生成します。黄色い円錐の回転ではありません。ただしメーカーのCADから作った刃ではありません。
- `beanGeometry`：球面パラメータから豆形状を生成し、蛇行するセンターカットに沿って頂点を凹ませ、法線を再計算します。
- 木目は決定的に生成する小さなテクスチャ。高品質版では測定済みのベースカラー／粗さ／法線へ移行します。

```js
const chrome = new THREE.MeshPhysicalMaterial({
  metalness: 1,
  roughness: 0.17,
  anisotropy: 0.65,
});
const ceramic = new THREE.MeshPhysicalMaterial({
  roughness: 0.23,
  clearcoat: 0.8,
  clearcoatRoughness: 0.12,
});
const hopperGlass = new THREE.MeshPhysicalMaterial({
  transmission: 1,
  thickness: 0.025,
  ior: 1.48,
  roughness: 0.08,
});
```

物理材質の値を上げるだけではリアルになりません。反射する環境、形状の面取り幅、接合、粗さ、正しいスケールが先に必要です。シャープな金属のエッジをBloomでごまかしません。

### CAD / glTFへの置き換え方

アセンブリは `machine / grinder / burr / basket / shower / tamper / cup` の独立ノードとし、原点、回転軸、接触面、材料スロットを定義します。CADのmmをmへ正規化してから表示スケールへ変換し、単位変換は1か所にまとめます。glTFの転送時はMeshopt、テクスチャはKTX2/Basisを候補にし、初回はLOD1、接写時にLOD0を読み込みます。

`KHR_materials_anisotropy`、`KHR_materials_clearcoat`、`KHR_materials_transmission`、`KHR_materials_volume`、必要に応じて `KHR_materials_ior` を使います。異方性の向きにはUV/tangentが必要です。クロームはベースカラーの写真に照明を焼き込まず、反射環境から光らせます。メーカーCAD・製品ロゴ・HDRI・テクスチャの利用権と配布権は納品アセットごとに記録します。

### 照明とポスト処理

現在はローカルに同梱したThree.jsとRoomEnvironmentからPMREMを生成します。CDN接続は不要。処理する色は線形、最後にACESとsRGBへ変換します。環境露出と吸収係数を同時に調整して「見た目だけ合う」状態を校正結果にしません。

シネマモードの外観では `RenderPass → SSRPass → SSAOPass → UnrealBloomPass → BokehPass → OutputPass`。Bloomは強い金属ハイライトに限定する高い閾値・弱い強度です。造形のUVを備えて異方性反射の接線系を定義し、Bloom入力では非数・無限大や極端なハイライトが多段ぼかしを汚染しないように制限しています。DoFは注視点距離に追従し、計器や粉体内部の観察を阻害しない浅い設定です。断面中はBloom以外の追加パスを止めます。

SSAOは微粉数十µmの個々の粒の陰影まで解く技術ではありません。そのスケールは材質法線／粗さ／遮蔽率で表現します。SSRは隠れたカップや画面外の機材を復元できません。GTAO・ボリュメトリックな湯気は今後のオプションで、今回のSSAOとスプライトをそれらと呼び替えません。

## 5. WebGPU：MLS-MPM / XPBD連成の実装

[GPUソルバーの実装設計書](gpu-solver.md) に、実行パス、構成則、SI単位、保存則、複数時間刻み、CPU／GPU境界、検証と残る条件をまとめました。コードは `src/gpu/coupled-solver.js`、`mpm.wgsl`、`porous.wgsl`、`liquid.wgsl` です。`coupled-solver-contract.ts` は実装に対応する公開型で、未実装を返すAPIではありません。

## 6. 導入順とリリース判定

| 段階     | 成果物                                                                  | 次へ進む条件                                                     |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| v4.1     | モバイルUI、WebGL PBR、断面、ベッド、液流、造形                         | 実ブラウザのシェーダー検査、既存の抽出体験、状態の一致、代替表示 |
| 次段階   | 材質とCAD、専用G-buffer、実機撮影とのルック調整                         | 寸法・権利確認、切断面／法線／深度の一致、代表端末の計測         |
| v4.2実装 | GPU MPM・多孔質流・溶出・XPBD回収・SSFR、保存則と高粒子数スモークテスト | 安息角・タンプ密度・圧損・流量と抽出曲線の再現性、質量収支       |
| 液体連成 | XPBD出口・SSFR・クレマ                                                  | 水／溶質／運動量収支、時間刻み・解像度に対する収束               |
| 商用判定 | アセットLOD、50k→100k→500k検証、品質自動制御、セッション復旧            | 狙う端末でのp50/p95時間・熱・メモリ・連続運転、校正誤差の公開    |

検証対象はDarcy流の解析解、単純せん断、静置山の安息角、タンピングの荷重−変位曲線、排液の重量履歴、溶出質量の収支を含めます。許容誤差は測定器の誤差と用途から決め、画像がきれいであることを物理の検証に代用しません。校正していない予測は、現在と同様に参考値と明示します。

## 主要な実装ファイル

- `src/render/espresso-scene.js`：画質、カメラ、部品、照明、ポスト処理の統合
- `src/render/cutaway.js`：クリッピングとステンシルキャップ
- `src/render/shaders.js`：ベッド変形、湿潤、微粒子、クレマ、湯気
- `src/render/fluid.js`：滴下と動的ストランド、液面
- `src/render/geometry.js`：精密プロシージャル形状
- `src/render/ssfr.js`：独立SSFR実装
- `src/gpu/wetting-reference.js` / `wetting.wgsl`：独立WebGPU計算例
- `src/gpu/coupled-solver.js` / `coupled-solver-contract.ts`：実装された連成ソルバーと公開型
- `src/gpu/mpm.wgsl` / `porous.wgsl` / `liquid.wgsl`：粉体・浸透溶出・液体の計算
- `src/gpu/gpu-view.js` / `view.wgsl` / `composite.wgsl`：GPU粒子の直接描画とSSFR
- `js/gpu-journey.js`：物理時間、制御、同じ試行のレポートへの接続

## 参考となる一次資料

- [Three.js MeshPhysicalMaterial](https://threejs.org/docs/#api/en/materials/MeshPhysicalMaterial)
- [Three.js clipping stencil example](https://threejs.org/examples/webgl_clipping_stencil.html)
- [Three.js WebGPU / TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU specification](https://www.w3.org/TR/webgpu/) / [WGSL specification](https://www.w3.org/TR/WGSL/)
- Hu et al., 2018, _A Moving Least Squares Material Point Method with Displacement Discontinuity and Two-Way Rigid Body Coupling_, ACM TOG.
- Klár et al., 2016, _Drucker-Prager Elastoplasticity for Sand Animation_, ACM TOG.
- Macklin et al., 2016, _XPBD: Position-Based Simulation of Compliant Constrained Dynamics_, MIG.
- van der Laan et al., 2009, _Screen Space Fluid Rendering with Curvature Flow_, I3D.

## 今回の検証環境

ChromiumのWebGLでシェーダーをコンパイルし、粉砕・圧密・湿潤・液流・シネマの画面を検査しています。SSFRは粒子深度への実際の書き込みと描画状態の復元も確認。WebGPU参照計算はSwiftShaderのadapterで実行し、流入量と水の積算、溶質濃度の保存を確認しました。これはスマホ実機のフレームレート、熱、精度の検証を代替するものではありません。
