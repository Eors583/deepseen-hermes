import sqlite3
conn=sqlite3.connect('C:/Users/Administrator/.hermes-web-ui/sessions.db')
cursor=conn.cursor()
cursor.execute("SELECT COUNT(*) FROM messages")
print("Total messages in web-ui DB:", cursor.fetchone()[0])
cursor.execute("SELECT content FROM messages WHERE role='user' ORDER BY id DESC LIMIT 5")
rows=cursor.fetchall()
for r in rows:
    print(str(r)[:500])