export interface BookChapter {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface BookItem {
  id: string;
  title: string;
  author: string;
  intro: string;
  cover: string;
  category: string;
  recommended: boolean;
  bestseller: boolean;
  chapters: BookChapter[];
}

const makeChapter = (book: string, index: number): BookChapter => ({
  id: `ch-${index}`,
  title: `第${index}章 · ${book}章节${index}`,
  paragraphs: [
    `这是《${book}》第${index}章的开篇内容。我们用这段文字来模拟阅读器分页、标注和听书流程。`,
    '阅读页支持从当前段落开始播放语音，系统会自动依次朗读，并在完成后继续到下一段。',
    '你可以选中文本进行复制、划线、写笔记。笔记会保存在当前浏览器，支持删除。',
    '为了便于演示，这里放入较短段落。真实接入时可以替换为完整章节正文。',
  ],
});

export const BOOKS: BookItem[] = [
  {
    id: 'book-1',
    title: '人类群星闪耀时',
    author: '斯蒂芬·茨威格',
    intro: '以历史关键时刻为切片，描摹人类命运转折点。',
    cover: 'https://picsum.photos/seed/book-a/420/620',
    category: '历史文学',
    recommended: true,
    bestseller: true,
    chapters: [1, 2, 3, 4, 5].map((i) => makeChapter('人类群星闪耀时', i)),
  },
  {
    id: 'book-2',
    title: '百年孤独',
    author: '加西亚·马尔克斯',
    intro: '魔幻现实主义经典，展现家族与时代的循环。',
    cover: 'https://picsum.photos/seed/book-b/420/620',
    category: '小说',
    recommended: true,
    bestseller: true,
    chapters: [1, 2, 3, 4].map((i) => makeChapter('百年孤独', i)),
  },
  {
    id: 'book-3',
    title: '苏菲的世界',
    author: '乔斯坦·贾德',
    intro: '以小说形式串联西方哲学发展脉络。',
    cover: 'https://picsum.photos/seed/book-c/420/620',
    category: '哲学',
    recommended: true,
    bestseller: false,
    chapters: [1, 2, 3, 4].map((i) => makeChapter('苏菲的世界', i)),
  },
  {
    id: 'book-4',
    title: '小王子',
    author: '圣埃克苏佩里',
    intro: '童话外壳下的人生寓言，适合反复阅读。',
    cover: 'https://picsum.photos/seed/book-d/420/620',
    category: '童话',
    recommended: true,
    bestseller: true,
    chapters: [1, 2, 3].map((i) => makeChapter('小王子', i)),
  },
  {
    id: 'book-5',
    title: '乌合之众',
    author: '古斯塔夫·勒庞',
    intro: '群体心理学经典，解释大众行为机制。',
    cover: 'https://picsum.photos/seed/book-e/420/620',
    category: '社会心理',
    recommended: true,
    bestseller: false,
    chapters: [1, 2, 3, 4, 5].map((i) => makeChapter('乌合之众', i)),
  },
  {
    id: 'book-6',
    title: '活着',
    author: '余华',
    intro: '在时代洪流中凝视普通人的生命韧性。',
    cover: 'https://picsum.photos/seed/book-f/420/620',
    category: '小说',
    recommended: true,
    bestseller: true,
    chapters: [1, 2, 3].map((i) => makeChapter('活着', i)),
  },
  {
    id: 'book-7',
    title: '原则',
    author: '瑞·达利欧',
    intro: '把决策经验抽象为可执行的个人与组织原则。',
    cover: 'https://picsum.photos/seed/book-g/420/620',
    category: '管理',
    recommended: false,
    bestseller: true,
    chapters: [1, 2, 3, 4].map((i) => makeChapter('原则', i)),
  },
  {
    id: 'book-8',
    title: '思考，快与慢',
    author: '丹尼尔·卡尼曼',
    intro: '行为经济学代表作，理解决策中的系统偏差。',
    cover: 'https://picsum.photos/seed/book-h/420/620',
    category: '认知科学',
    recommended: false,
    bestseller: true,
    chapters: [1, 2, 3, 4].map((i) => makeChapter('思考，快与慢', i)),
  },
  {
    id: 'book-9',
    title: '被讨厌的勇气',
    author: '岸见一郎 / 古贺史健',
    intro: '以对话体展开阿德勒心理学，强调课题分离。',
    cover: 'https://picsum.photos/seed/book-i/420/620',
    category: '心理成长',
    recommended: false,
    bestseller: false,
    chapters: [1, 2, 3].map((i) => makeChapter('被讨厌的勇气', i)),
  },
  {
    id: 'book-10',
    title: '穷查理宝典',
    author: '彼得·考夫曼',
    intro: '查理·芒格思想合集，跨学科决策模型实践指南。',
    cover: 'https://picsum.photos/seed/book-j/420/620',
    category: '投资',
    recommended: false,
    bestseller: true,
    chapters: [1, 2, 3, 4].map((i) => makeChapter('穷查理宝典', i)),
  },
];

export const RECOMMENDED_BOOKS = BOOKS.filter((b) => b.recommended);
export const BESTSELLER_BOOKS = BOOKS.filter((b) => b.bestseller);

export function getBookById(id: string): BookItem | undefined {
  return BOOKS.find((b) => b.id === id);
}
