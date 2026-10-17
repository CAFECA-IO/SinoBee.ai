/**
 * Default proposal screening checklist (version 1). Six dimensions, every item a yes/no question where "yes" means
 * the proposal complies. A proposal opens only when every item is "yes". Admins can change the list in /admin →
 * Checklist; each published version is public in the crowdfunding terms.
 */

export const DIMENSIONS = ["legal", "privacy", "ip", "safety", "feasibility", "spec"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type ChecklistItem = { id: string; dimension: Dimension; zh: string; en: string };

const L = (n: number, zh: string, en: string): ChecklistItem => ({ id: `L${String(n).padStart(2, "0")}`, dimension: "legal", zh, en });
const P = (n: number, zh: string, en: string): ChecklistItem => ({ id: `P${String(n).padStart(2, "0")}`, dimension: "privacy", zh, en });
const I = (n: number, zh: string, en: string): ChecklistItem => ({ id: `I${String(n).padStart(2, "0")}`, dimension: "ip", zh, en });
const S = (n: number, zh: string, en: string): ChecklistItem => ({ id: `S${String(n).padStart(2, "0")}`, dimension: "safety", zh, en });
const F = (n: number, zh: string, en: string): ChecklistItem => ({ id: `F${String(n).padStart(2, "0")}`, dimension: "feasibility", zh, en });
const V = (n: number, zh: string, en: string): ChecklistItem => ({ id: `V${String(n).padStart(2, "0")}`, dimension: "spec", zh, en });

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  // ───── 1. 合法性 Legality ─────
  L(1, "任務目的與內容符合中華民國法令。", "The purpose and content of the task comply with the laws of Taiwan (R.O.C.)."),
  L(2, "任務不涉及任何犯罪行為或協助、教唆他人犯罪。", "The task involves no criminal act and does not help or encourage anyone to commit one."),
  L(3, "任務不涉及詐欺、詐騙或誤導他人財物決定。", "The task involves no fraud, scam or misleading of people's financial decisions."),
  L(4, "任務不涉及洗錢、規避金融監理或製作不實財務資料。", "The task involves no money laundering, evasion of financial regulation or false financial records."),
  L(5, "任務不涉及賭博或未經許可的博弈活動。", "The task involves no gambling or unlicensed gaming."),
  L(6, "任務不涉及管制或違禁物品的取得、製造或交易。", "The task involves no obtaining, making or trading of controlled or prohibited goods."),
  L(7, "任務不涉及未經授權存取他人系統、帳號或資料。", "The task involves no unauthorized access to other people's systems, accounts or data."),
  L(8, "任務不要求規避網站服務條款、付費牆或存取限制。", "The task does not require bypassing a website's terms, paywalls or access controls."),
  L(9, "任務不涉及冒用他人身分、偽造文件或簽章。", "The task involves no impersonation and no forging of documents or signatures."),
  L(10, "任務不涉及製作或散布不實訊息以影響選舉或公共事務。", "The task does not create or spread false information to influence elections or public affairs."),
  L(11, "任務不涉及誹謗、公然侮辱或侵害他人名譽。", "The task involves no defamation, public insult or harm to anyone's reputation."),
  L(12, "任務不涉及不公平競爭、操縱市場或內線交易。", "The task involves no unfair competition, market manipulation or insider trading."),
  L(13, "任務不違反消費者保護、廣告或公平交易相關規範。", "The task does not violate consumer protection, advertising or fair trade rules."),
  L(14, "任務不涉及違反出口管制或經濟制裁的行為。", "The task involves nothing that breaches export controls or economic sanctions."),
  L(15, "任務不要求提供須具專業執照者才能提供的個人化法律、醫療或財務建議。", "The task does not ask for personalized legal, medical or financial advice that only licensed professionals may give."),
  L(16, "任務不涉及大量發送未經同意的廣告訊息。", "The task involves no unsolicited mass advertising messages."),
  L(17, "任務不涉及偽造評價、假帳號或操縱網路聲量。", "The task involves no fake reviews, fake accounts or manipulation of online reputation."),
  L(18, "任務成果的用途不違反本站服務條款第 4 節。", "The intended use of the results does not violate section 4 of the Terms of Service."),

  // ───── 2. 個資與隱私 Privacy ─────
  P(1, "任務不蒐集、處理或利用可識別特定自然人的個人資料，或僅使用已依法公開且與目的相關的資料。", "The task does not collect, process or use personal data identifying a natural person, or uses only data lawfully made public and relevant to its purpose."),
  P(2, "任務不涉及針對特定個人的追蹤、定位或行蹤調查。", "The task involves no tracking, locating or investigating the movements of a specific person."),
  P(3, "任務不涉及彙整特定個人資料以建立其檔案。", "The task does not compile information about a specific person into a profile."),
  P(4, "任務不涉及蒐集他人聯絡方式供推銷或騷擾之用。", "The task does not gather people's contact details for marketing or harassment."),
  P(5, "任務不涉及病歷、健康、基因、性生活或犯罪前科等特種個人資料。", "The task involves no special categories of personal data such as medical, health, genetic, sexual or criminal records."),
  P(6, "任務不涉及兒童或青少年的個人資料。", "The task involves no personal data of children or minors."),
  P(7, "任務不涉及財務帳戶、證件號碼或密碼等敏感資料。", "The task involves no financial account numbers, ID numbers, passwords or similar sensitive data."),
  P(8, "上傳的參考檔案不含未經當事人同意的個人資料。", "The uploaded reference files contain no personal data without the data subject's consent."),
  P(9, "任務不要求辨識照片、影像或聲音中的特定個人身分。", "The task does not require identifying specific people in photos, video or audio."),
  P(10, "任務不涉及未經同意的監看、竊聽或側錄。", "The task involves no monitoring, eavesdropping or recording without consent."),
  P(11, "任務成果不會公開可識別特定個人的非公開資訊。", "The results will not disclose non-public information that identifies a specific person."),
  P(12, "若處理匿名或統計資料，任務不嘗試重新識別個人。", "If anonymized or statistical data is used, the task makes no attempt to re-identify individuals."),
  P(13, "任務不需要使用他人的登入帳號或憑證。", "The task does not need anyone else's login account or credentials."),
  P(14, "任務不涉及跨境傳輸受限制的個人資料。", "The task involves no restricted cross-border transfer of personal data."),
  P(15, "任務的資料來源允許該用途，且不違反其隱私政策。", "The data sources permit this use and the task does not break their privacy policies."),
  P(16, "任務不涉及員工、學生或其他特定群體的評比或監控。", "The task involves no rating or monitoring of employees, students or other specific groups of people."),

  // ───── 3. 智慧財產權 Intellectual property ─────
  I(1, "任務不涉及重製或散布受著作權保護而未獲授權的作品。", "The task involves no copying or distribution of copyrighted works without permission."),
  I(2, "任務不涉及書籍、課程、音樂、影片或付費文章的全文重製。", "The task involves no full reproduction of books, courses, music, films or paid articles."),
  I(3, "上傳的參考檔案為發起人自有或有權提供。", "The uploaded reference files are the proposer's own or the proposer has the right to provide them."),
  I(4, "任務不涉及仿冒商標或使用他人商標造成混淆。", "The task involves no counterfeit trademarks or confusing use of someone else's trademark."),
  I(5, "任務不涉及破解、移除或規避數位版權保護措施。", "The task does not crack, remove or bypass digital rights management."),
  I(6, "任務不涉及取得或洩漏營業秘密。", "The task does not obtain or disclose trade secrets."),
  I(7, "任務若引用他人資料，交付物會標示來源。", "Where the task uses others' material, the deliverables will cite the sources."),
  I(8, "任務不要求以他人具名風格冒充其作品。", "The task does not ask to pass off work as made by a named person."),
  I(9, "任務使用的軟體與資料授權允許該用途。", "The licenses of the software and data used allow this use."),
  I(10, "任務不涉及違反網站授權條款的大量擷取。", "The task involves no bulk extraction that breaks a website's license terms."),
  I(11, "任務成果不會侵害第三人的專利或設計權。", "The results will not infringe third-party patents or design rights."),
  I(12, "成果授權方式不與發起人提供的素材授權衝突。", "The license of the results does not conflict with the licenses of the material the proposer supplies."),
  I(13, "任務不涉及複製他人網站、應用程式或品牌外觀。", "The task does not copy another website's, app's or brand's look."),
  I(14, "任務若產生衍生作品，原作授權允許改作。", "If the task creates derivative works, the original's license allows adaptation."),
  I(15, "任務不涉及販售或散布他人的個人肖像。", "The task involves no selling or distribution of other people's likeness."),
  I(16, "任務不涉及未經授權的資料庫整體重製。", "The task involves no unauthorized copying of a database as a whole."),
  I(17, "發起人同意成果依本站服務條款提供給出資者下載與使用。", "The proposer agrees that the results are provided to backers to download and use under the Terms of Service."),

  // ───── 4. 安全與倫理 Safety & ethics ─────
  S(1, "任務不涉及可能造成人身傷害的內容。", "The task involves no content that could cause physical harm to people."),
  S(2, "任務不涉及大規模殺傷性武器或其相關知識。", "The task involves no weapons capable of mass harm or knowledge about them."),
  S(3, "任務不涉及惡意程式、攻擊工具或資安漏洞的濫用。", "The task involves no malware, attack tools or misuse of security vulnerabilities."),
  S(4, "任務不涉及自傷、自殺或飲食失調的鼓勵內容。", "The task involves no content encouraging self-harm, suicide or eating disorders."),
  S(5, "任務不涉及任何與未成年人有關的性內容。", "The task involves no sexual content of any kind involving minors."),
  S(6, "任務不涉及露骨色情內容。", "The task involves no explicit sexual content."),
  S(7, "任務不涉及仇恨、歧視或對特定群體的貶抑。", "The task involves no hate, discrimination or demeaning of any group."),
  S(8, "任務不涉及騷擾、威脅或霸凌他人。", "The task involves no harassment, threats or bullying."),
  S(9, "任務不涉及暴力極端主義或恐怖主義的宣傳。", "The task involves no promotion of violent extremism or terrorism."),
  S(10, "任務不涉及製作冒充真人的深偽內容。", "The task involves no deepfakes that impersonate real people."),
  S(11, "任務不涉及危害關鍵基礎設施或公共安全。", "The task involves nothing that endangers critical infrastructure or public safety."),
  S(12, "任務不涉及動物虐待。", "The task involves no animal cruelty."),
  S(13, "任務不以操弄、欺騙或剝削弱勢者為目的。", "The task is not aimed at manipulating, deceiving or exploiting vulnerable people."),
  S(14, "任務成果若可能被濫用，提案已說明合理的使用範圍。", "If the results could be misused, the proposal states a reasonable scope of use."),
  S(15, "任務不要求 Agent 與真人進行未揭露 AI 身分的互動。", "The task does not require the agent to interact with real people without disclosing that it is an AI."),
  S(16, "任務不涉及對他人系統造成過量負載的行為。", "The task involves nothing that places excessive load on other people's systems."),
  S(17, "任務不涉及醫療處置或用藥的具體指示。", "The task involves no specific instructions for medical treatment or medication."),
  S(18, "任務的公開內容不含令人不適的血腥或暴力畫面描述。", "The public content of the task contains no graphic gore or violence."),

  // ───── 5. 技術可行性 Feasibility ─────
  F(1, "任務可以由 AI Agent 在隔離的 Linux 容器中自主完成。", "The task can be completed autonomously by an AI agent in an isolated Linux container."),
  F(2, "任務不需要真人在執行期間回答問題或操作。", "The task does not need a person to answer questions or act during the run."),
  F(3, "任務不需要實體操作、實地拜訪或郵寄物品。", "The task needs no physical action, site visit or mailing."),
  F(4, "任務所需的資料來源可以公開取得，或已由發起人上傳。", "The data the task needs is publicly available or uploaded by the proposer."),
  F(5, "任務不需要付費帳號、訂閱或額外購買才能完成。", "The task needs no paid account, subscription or extra purchase to complete."),
  F(6, "任務不需要使用者的帳號密碼、驗證碼或付款資訊。", "The task needs no user passwords, verification codes or payment details."),
  F(7, "任務所需工具可在一般 Linux 環境中安裝使用。", "The tools the task needs can be installed and used in a standard Linux environment."),
  F(8, "任務的運算量在單一容器的合理範圍內（不需 GPU 叢集等特殊硬體）。", "The computing needed fits a single container (no GPU cluster or other special hardware)."),
  F(9, "任務可在平台的單次執行時數上限內完成，或已拆成可分段完成的里程碑。", "The task fits the platform's maximum run time, or is split into milestones that can be done in parts."),
  F(10, "任務的成本估算（P50、P90）有合理依據。", "The cost estimate (P50, P90) has a reasonable basis."),
  F(11, "目標金額足以涵蓋 P90 估算與服務費。", "The goal covers the P90 estimate plus the service fee."),
  F(12, "任務選用的模型適合該任務。", "The chosen model suits the task."),
  F(13, "任務不依賴可能於執行前失效的一次性資源。", "The task does not depend on one-off resources likely to disappear before it runs."),
  F(14, "任務需要的外部服務允許自動化存取。", "The external services the task needs allow automated access."),
  F(15, "交付物的檔案格式可由 Agent 產生。", "The agent can produce the deliverables' file formats."),
  F(16, "任務失敗時能交付有意義的部分成果。", "If the task fails, meaningful partial results can still be delivered."),
  F(17, "任務的規模與眾籌期間及目標金額相稱。", "The size of the task matches the campaign period and the goal."),
  F(18, "延伸目標（如有）同樣可行且金額合理。", "Stretch goals, if any, are feasible too and reasonably priced."),

  // ───── 6. 規格完整與可驗收 Spec & acceptance ─────
  V(1, "任務名稱清楚描述要完成的事。", "The task name clearly says what will be done."),
  V(2, "需求摘要說明了問題、背景與期待的成果。", "The summary explains the problem, the context and the expected result."),
  V(3, "範圍與不包含的項目已明確界定。", "The scope and what is out of scope are clearly defined."),
  V(4, "交付物列出了具體檔案或成果與格式。", "The deliverables list concrete files or results and their formats."),
  V(5, "執行方法列出可追蹤的步驟或里程碑。", "The method lists trackable steps or milestones."),
  V(6, "驗收標的為 3 到 7 條可檢驗的條件。", "The acceptance criteria are 3 to 7 checkable conditions."),
  V(7, "每條驗收標的都能以是或否判斷是否達成。", "Each acceptance criterion can be judged met or not met with a yes or no."),
  V(8, "驗收標的不依賴發起人個人的主觀喜好。", "The acceptance criteria do not depend on the proposer's personal taste."),
  V(9, "驗收標的與交付物一一對應。", "The acceptance criteria correspond to the deliverables."),
  V(10, "風險與假設已列出，包含失敗時的部分交付內容。", "Risks and assumptions are listed, including what is delivered if the task fails."),
  V(11, "規格內容與任務描述一致，沒有互相矛盾。", "The spec is consistent with the task description and does not contradict itself."),
  V(12, "規格沒有隱藏或模糊的額外要求。", "The spec contains no hidden or vague extra requirements."),
  V(13, "規格的語言讓一般出資者能理解。", "The spec is written so that ordinary backers can understand it."),
  V(14, "延伸目標（如有）各自列出內容與金額。", "Each stretch goal, if any, states its content and amount."),
  V(15, "參考檔案的公開範圍設定合理。", "The visibility settings of the reference files are reasonable."),
  V(16, "提案沒有誇大或誤導性的宣傳文字。", "The proposal contains no exaggerated or misleading claims."),
  V(17, "提案沒有包含要求 Agent 忽略規格或平台規則的指示。", "The proposal contains no instructions telling the agent to ignore the spec or platform rules."),
  V(18, "提案沒有包含與任務無關的推銷內容或外部連結。", "The proposal contains no unrelated promotion or external links."),
];
