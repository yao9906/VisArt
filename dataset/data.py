import pandas as pd
import os

# 1. 定义文件名列表
file_names = [
    'csv-1700-1830.csv', 
    'csv-1831-2000.csv', 
    'csv-2001-2131.csv'
]

# 2. 读取并合并
dfs = []
for file in file_names:
    # 检查文件是否存在
    if os.path.exists(file):
        try:
            # encoding='ISO-8859-1' 是 VAST Challenge 数据集常用的编码，如果报错改成 'utf-8'
            df = pd.read_csv(file, encoding='ISO-8859-1') 
            dfs.append(df)
            print(f"成功读取: {file}, 行数: {len(df)}")
        except Exception as e:
            print(f"读取失败 {file}: {e}")
    else:
        print(f"文件未找到: {file}")

if dfs:
    # 合并所有 DataFrame
    merged_df = pd.concat(dfs, ignore_index=True)

    # 3. (可选) 数据清洗建议：转换时间格式
    # VAST的时间格式通常是 yyyyMMddHHmmss (例如 20140123170000)
    # 转换成标准 datetime 对象，方便后续 D3 或后端处理
    merged_df['date'] = pd.to_datetime(merged_df['date(yyyyMMddHHmmss)'], format='%Y%m%d%H%M%S', errors='coerce')

    # 4. 保存为新的 CSV
    output_name = 'merged_mc3_data.csv'
    merged_df.to_csv(output_name, index=False, encoding='utf-8')
    print(f"\n合并完成！总行数: {len(merged_df)}")
    print(f"文件已保存为: {output_name}")
else:
    print("没有数据被合并。")