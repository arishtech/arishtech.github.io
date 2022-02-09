<div class="col-lg-4 col-md-12 grid-post-item single-post-item">
    <div id="post-<?php the_ID(); ?>" <?php post_class('post-single'); ?>>
       <div class="post-contents">
            <div class="post-title">
                <?php the_title( '<h2 class="entry-title"><a href="' . esc_url( get_permalink() ) . '" rel="bookmark">', '</a></h2>' ); ?>
            </div>
       </div>
    </div>
</div>