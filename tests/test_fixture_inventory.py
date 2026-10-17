import unittest
from fixture_inventory import differences

class InventoryTests(unittest.TestCase):
    def test_exact_inventory_and_parent(self):
        expected={'/series':('Series',None,'Series'),'/series/season':('Season','/series',None),'/series/season/ep':('Episode','/series/season',None)}
        items=[{'Id':'s','Type':'Series','Name':'Series','Path':'/series'}, {'Id':'t','Type':'Season','Name':'Season 1','Path':'/series/season','ParentId':'s'}, {'Id':'e','Type':'Episode','Name':'Episode','Path':'/series/season/ep','ParentId':'t'}]
        self.assertEqual(differences(items,expected),[])
        items[-1]['ParentId']='s'
        self.assertTrue(any('wrongParent' in issue for issue in differences(items,expected)))
    def test_episodes_do_not_prove_movie_readiness(self):
        self.assertTrue(differences([],{'/movie':('Movie',None,'Required')}))
    def test_extra_items_are_contamination(self):
        self.assertTrue(differences([{'Id':'x','Type':'Movie','Name':'Unexpected','Path':'/x'}],{}))

if __name__=='__main__': unittest.main()
