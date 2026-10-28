from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
R=Path(r'E:\Gomoku');lines=(R/'artifacts/git-history.txt').read_text(encoding='utf-8').strip().splitlines()
im=Image.new('RGB',(1500,220+len(lines)*100),'#fff');d=ImageDraw.Draw(im);font=ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc',25);title=ImageFont.truetype(r'C:\Windows\Fonts\msyhbd.ttc',36)
d.text((55,35),'本地 Git 真实版本记录',font=title,fill='#20332b');d.text((55,100),'原始记录：git log --date=iso-strict；本地仓库，尚未推送远程平台。',font=font,fill='#68796c')
for i,line in enumerate(lines):
 y=180+i*100;d.rounded_rectangle((55,y-10,1440,y+75),radius=10,fill='#edf3ed');text=line.split(' | ');d.text((75,y),' | '.join(text[:2]),font=font,fill='#28533d');d.text((75,y+36),' | '.join(text[2:]),font=font,fill='#20332b')
im.save(R/'docs/assets/git-history.png');print('Rendered',len(lines),'genuine Git records')
